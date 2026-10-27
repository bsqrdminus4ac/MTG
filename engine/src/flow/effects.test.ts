import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../model/cardDefinition";
import type { Amount, Effect } from "../model/effects";
import { cardDefId, playerId, type CardDefId, type ObjectId, type StackId } from "../model/ids";
import type { GameState, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { damageObject, damagePlayer } from "../rules/primitives";
import { createGame } from "../setup";
import { executeEffect, resolveAmount, type EffectContext, type StepResult } from "./effects";
import { handleResolutionDecision, runResolution } from "./resolution";
import { submitAnswer } from "../engine";

const alice = playerId("alice");
const bob = playerId("bob");

const bear: CardDefinition = {
  id: cardDefId("bear"),
  name: "Grizzly Bears",
  manaCost: { generic: 1, pips: ["G"] as const },
  colors: ["G"] as const,
  supertypes: [],
  types: ["Creature"] as const,
  subtypes: ["Bear"] as const,
  power: 2,
  toughness: 2,
  abilities: [],
};

const planeswalker: CardDefinition = {
  id: cardDefId("planeswalker"),
  name: "Test Planeswalker",
  manaCost: { generic: 2, pips: ["U"] },
  colors: ["U"],
  supertypes: [],
  types: ["Planeswalker"],
  subtypes: ["Test"],
  power: null,
  toughness: null,
  abilities: [],
};

function newGame(
  definitions: readonly CardDefinition[] = [bear],
  deck: readonly CardDefId[] = Array.from({ length: 5 }, () => bear.id),
): GameState {
  return createGame(definitions, [{ id: alice, deck }, { id: bob, deck }]);
}

function putOnBattlefield(state: GameState, player: typeof alice, definitionId = bear.id) {
  const card = state.players[player]?.library.find((id) => state.objects[id]?.definitionId === definitionId);
  if (card === undefined) throw new Error("Expected a card in the library");
  const moved = moveObject(state, card, "battlefield");
  if (!moved) throw new Error("Expected the card to move");
  return moved;
}

function putCardsInHand(state: GameState, player: typeof alice, count: number): GameState {
  let current = state;
  for (const id of state.players[player]?.library.slice(0, count) ?? []) {
    const moved = moveObject(current, id, "hand");
    if (!moved) throw new Error("Expected the card to move to hand");
    current = moved.state;
  }
  return current;
}

function resolvingState(state: GameState, effects: Effect[]): GameState {
  const source = state.players[alice]!.library.at(-1)!;
  return {
    ...state,
    priority: null,
    resolving: {
      entry: {
        kind: "ability",
        id: state.nextId as StackId,
        controller: alice,
        source,
        targets: [],
        definitionId: bear.id,
        abilityIndex: 0,
      },
      effects,
      pc: 0,
      bindings: {},
    },
  };
}

const chooseFromControllerHand: Effect = {
  kind: "choose",
  chooser: { kind: "player", who: "opponent" },
  from: { kind: "hand", of: { kind: "player", who: "controller" } },
  min: 1,
  max: 2,
  bindAs: "chosen",
  prompt: "Choose cards",
};

function context(source: ObjectId, targets: readonly Target[] = []): EffectContext {
  return {
    source,
    controller: alice,
    targets,
    legalTargets: targets.map(() => true),
    bindings: {},
  };
}

describe("resolveAmount", () => {
  test("resolves a bound number", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;
    const amount: Amount = { kind: "bound", name: "amount" };
    const ctx = { ...context(source), bindings: { amount: 4 } };

    expect(resolveAmount(state, ctx, amount)).toEqual({ ok: true, value: 4 });
  });

  test("resolves a bound list to its length", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;
    const amount: Amount = { kind: "bound", name: "chosen" };
    const ctx = {
      ...context(source),
      bindings: {
        chosen: [
          { kind: "index" as const, index: 0 },
          { kind: "index" as const, index: 1 },
          { kind: "index" as const, index: 2 },
        ],
      },
    };

    expect(resolveAmount(state, ctx, amount)).toEqual({ ok: true, value: 3 });
  });

  test("returns an error for an unbound name", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;
    const amount: Amount = { kind: "bound", name: "missing" };

    expect(resolveAmount(state, context(source), amount)).toEqual({
      ok: false,
      error: "Unbound name missing",
    });
  });
});

function complete(result: StepResult) {
  if (!result.ok) throw new Error(result.error);
  if (result.waiting) throw new Error("Expected the effect to complete");
  return result;
}

describe("player effects", () => {
  test("choice waits for the chooser with priority cleared", () => {
    const state = putCardsInHand(newGame(), alice, 3);
    const resolving = resolvingState(state, [chooseFromControllerHand]);

    const result = runResolution(resolving);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pending).toMatchObject({
      kind: "choose",
      player: bob,
      options: expect.arrayContaining([
        expect.objectContaining({ label: "Grizzly Bears" }),
      ]),
    });
    expect(result.state.pending?.kind === "choose" && result.state.pending.options).toHaveLength(3);
    expect(result.state.priority).toBeNull();
  });

  test("answering a choice binds the selection and continues resolution", () => {
    const state = putCardsInHand(newGame(), alice, 3);
    const resolving = resolvingState(state, [
      chooseFromControllerHand,
      { kind: "gainLife", who: "controller", amount: { kind: "bound", name: "chosen" } },
    ]);
    const waiting = runResolution(resolving);
    if (!waiting.ok || waiting.state.pending?.kind !== "choose") throw new Error("Expected a choose decision");
    const selected = waiting.state.pending.options[0];
    if (!selected) throw new Error("Expected a choice option");

    const result = submitAnswer(waiting.state, {
      player: bob,
      decision: waiting.state.pending.id,
      answer: { kind: "choose", selected: [selected.id] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[alice]?.life).toBe(21);
    expect(result.state.resolving).toBeNull();
  });

  test("rejects a choice answer outside the allowed selection bounds", () => {
    const state = putCardsInHand(newGame(), alice, 3);
    const waiting = runResolution(resolvingState(state, [chooseFromControllerHand]));
    if (!waiting.ok || waiting.state.pending?.kind !== "choose") throw new Error("Expected a choose decision");

    const result = submitAnswer(waiting.state, {
      player: bob,
      decision: waiting.state.pending.id,
      answer: { kind: "choose", selected: waiting.state.pending.options.map((option) => option.id) },
    });

    expect(result).toMatchObject({ ok: false, error: "Choose between 1 and 2" });
  });

  test("rejects canceling a choice effect", () => {
    const state = putCardsInHand(newGame(), alice, 3);
    const waiting = runResolution(resolvingState(state, [chooseFromControllerHand]));
    if (!waiting.ok || waiting.state.pending?.kind !== "choose") throw new Error("Expected a choose decision");

    const result = submitAnswer(waiting.state, {
      player: bob,
      decision: waiting.state.pending.id,
      answer: { kind: "cancel" },
    });

    expect(result).toMatchObject({ ok: false, error: "This decision cannot be canceled" });
  });

  test("clamps the selection bounds to the number of hand options", () => {
    const state = putCardsInHand(newGame(), alice, 3);
    const effect: Effect = { ...chooseFromControllerHand, min: 4, max: 8 };
    const resolving = resolvingState(state, [effect]);

    const result = runResolution(resolving);

    expect(result.ok).toBe(true);
    if (!result.ok || result.state.pending?.kind !== "choose") return;
    expect(result.state.pending.min).toBe(3);
    expect(result.state.pending.max).toBe(3);
  });

  test("skips the choice decision and binds an empty selection when the hand is empty", () => {
    const resolving = resolvingState(newGame(), [
      chooseFromControllerHand,
      { kind: "gainLife", who: "controller", amount: { kind: "bound", name: "chosen" } },
    ]);

    const result = runResolution(resolving);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pending?.kind).toBe("priority");
    expect(result.state.players[alice]?.life).toBe(20);
    expect(result.state.resolving).toBeNull();
  });

  test("resolution decision stores a binding before running the next effect", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;
    const resolvingState: GameState = {
      ...state,
      resolving: {
        entry: {
          kind: "ability",
          id: state.nextId as StackId,
          controller: alice,
          source,
          targets: [],
          definitionId: bear.id,
          abilityIndex: 0,
        },
        effects: [
          { kind: "gainLife", who: "controller", amount: 1 },
          { kind: "gainLife", who: "controller", amount: { kind: "bound", name: "amount" } },
        ],
        pc: 0,
        bindings: {},
      },
    };

    const result = handleResolutionDecision(resolvingState, "amount", {
      kind: "choose",
      chosen: [
        { id: "first", label: "First", value: { kind: "index", index: 0 } },
        { id: "second", label: "Second", value: { kind: "index", index: 1 } },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[alice]?.life).toBe(22);
    expect(result.events).toContainEqual({ type: "lifeChanged", player: alice, delta: 2 });
  });

  test("gainLife uses a bound amount", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;
    const ctx = { ...context(source), bindings: { x: 5 } };

    const result = complete(
      executeEffect(state, ctx, {
        kind: "gainLife",
        who: "opponent",
        amount: { kind: "bound", name: "x" },
      }),
    );

    expect(result.state.players[bob]?.life).toBe(25);
    expect(result.events).toEqual([{ type: "lifeChanged", player: bob, delta: 5 }]);
  });

  test("gainLife increases the chosen player's life and emits a lifeChanged event", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;

    const result = complete(
      executeEffect(state, context(source), { kind: "gainLife", who: "opponent", amount: 3 }),
    );

    expect(result.state.players[alice]?.life).toBe(20);
    expect(result.state.players[bob]?.life).toBe(23);
    expect(result.events).toEqual([{ type: "lifeChanged", player: bob, delta: 3 }]);
  });

  test("loseLife decreases the controller's life and emits a negative lifeChanged event", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;

    const result = complete(
      executeEffect(state, context(source), { kind: "loseLife", who: "controller", amount: 4 }),
    );

    expect(result.state.players[alice]?.life).toBe(16);
    expect(result.state.players[bob]?.life).toBe(20);
    expect(result.events).toEqual([{ type: "lifeChanged", player: alice, delta: -4 }]);
  });

  test("addMana adds mana to the controller's pool and emits a manaAdded event", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;

    const result = complete(
      executeEffect(state, context(source), { kind: "addMana", mana: "R", amount: 2 }),
    );

    expect(result.state.players[alice]?.manaPool.R).toBe(2);
    expect(result.state.players[bob]?.manaPool.R).toBe(0);
    expect(result.events).toEqual([{ type: "manaAdded", player: alice, mana: "R", amount: 2 }]);
  });
});

describe("destroy effect", () => {
  test("moves a targeted permanent to its owner's graveyard and emits destruction events", () => {
    const source = putOnBattlefield(newGame(), alice);
    const target = putOnBattlefield(source.state, bob);
    const effect: Effect = { kind: "destroy", target: { kind: "target", index: 0 } };

    const result = complete(
      executeEffect(target.state, context(source.newId, [{ kind: "object", id: target.newId }]), effect),
    );
    const graveyardId = result.state.players[bob]?.graveyard.at(-1);

    expect(result.state.objects[target.newId]).toBeUndefined();
    expect(graveyardId).toBeDefined();
    expect(result.state.objects[graveyardId!]).toMatchObject({ definitionId: bear.id, zone: "graveyard" });
    expect(result.events).toEqual([
      { type: "permanentDestroyed", object: target.newId, cardName: "Grizzly Bears", source: source.newId },
      {
        type: "cardMoved",
        from: "battlefield",
        to: "graveyard",
        oldId: target.newId,
        newId: graveyardId,
        owner: bob,
      },
    ]);
  });
});

describe("damage helpers", () => {
  test("damagePlayer reduces life and reports combat damage", () => {
    const state = newGame();
    const source = state.players[alice]!.library.at(-1)!;

    const result = damagePlayer(state, bob, source, 3, true);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players[bob]?.life).toBe(17);
    expect(result.events).toEqual([
      {
        type: "damageDealt",
        source,
        sourceName: "Grizzly Bears",
        amount: 3,
        target: { kind: "player", id: bob },
        targetName: "",
        isCombatDamage: true,
      },
    ]);
  });

  test("damageObject marks a creature and reports noncombat damage", () => {
    const source = putOnBattlefield(newGame(), alice);
    const target = putOnBattlefield(source.state, bob);

    const result = damageObject(target.state, target.newId, source.newId, 2, false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.objects[target.newId]?.damage).toBe(2);
    expect(result.events).toEqual([
      {
        type: "damageDealt",
        source: source.newId,
        sourceName: "Grizzly Bears",
        amount: 2,
        target: { kind: "object", id: target.newId },
        targetName: "Grizzly Bears",
        isCombatDamage: false,
      },
    ]);
  });

  test("damageObject removes loyalty from a planeswalker and reports damage", () => {
    const state = newGame([bear, planeswalker], [bear.id, planeswalker.id]);
    const source = putOnBattlefield(state, alice, bear.id);
    const target = putOnBattlefield(source.state, bob, planeswalker.id);
    const targetObject = target.state.objects[target.newId]!;
    const withLoyalty = {
      ...target.state,
      objects: {
        ...target.state.objects,
        [target.newId]: { ...targetObject, counters: { loyalty: 5 } },
      },
    };

    const result = damageObject(withLoyalty, target.newId, source.newId, 2, false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.objects[target.newId]?.counters.loyalty).toBe(3);
    expect(result.events).toEqual([
      {
        type: "damageDealt",
        source: source.newId,
        sourceName: "Grizzly Bears",
        amount: 2,
        target: { kind: "object", id: target.newId },
        targetName: "Test Planeswalker",
        isCombatDamage: false,
      },
    ]);
  });
});
