import { describe, expect, test } from "vitest";
import { type CardDefinition, type Effect } from "../model/cards";
import { cardDefId, playerId, type CardDefId, type ObjectId } from "../model/ids";
import type { GameState, Target } from "../model/state";
import { moveObject } from "../model/zones";
import { damageObject, damagePlayer } from "../rules/primitives";
import { createGame } from "../setup";
import { executeEffect, type EffectContext, type StepResult } from "./effects";

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

function context(source: ObjectId, targets: readonly Target[] = []): EffectContext {
  return {
    source,
    controller: alice,
    targets,
    legalTargets: targets.map(() => true),
    bindings: {},
  };
}

function complete(result: StepResult) {
  if (!result.ok) throw new Error(result.error);
  if (result.waiting) throw new Error("Expected the effect to complete");
  return result;
}

describe("player effects", () => {
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
