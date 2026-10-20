import { describe, expect, test } from "vitest";
import {
    applyAction,
    cardDefId,
    createGame,
    drawCard,
    getCharacteristics,
    moveObject,
    playerId,
    submitAnswer,
    type CardDefinition,
    type ContinuousEffect,
    type GameState,
    type Timestamp,
} from "./index";

const alice = playerId("alice");
const bob = playerId("bob");

const bear: CardDefinition = {
  id: cardDefId("bear"),
  name: "Grizzly Bears",
  manaCost: { generic: 1, pips: ["G"] },
  colors: ["G"],
  supertypes: [],
  types: ["Creature"],
  subtypes: ["Bear"],
  power: 2,
  toughness: 2,
  abilities: [],
};

const targetSpell: CardDefinition = {
    ...bear,
    id: cardDefId("target-spell"),
    name: "Target Spell",
    manaCost: { generic: 0, pips: [] },
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [
        {
            kind: "spell",
            targets: [
                {
                    kind: "Player",
                    allowedTypes: "any",
                    zone: "battlefield",
                    minCount: 1,
                    maxCount: 1,
                },
            ],
            effects: [],
        },
    ],
};

function newGame(): GameState {
  const deck = Array.from({ length: 5 }, () => bear.id);
  return createGame([bear], [{ id: alice, deck }, { id: bob, deck }]);
}

describe("setup", () => {
  test("builds libraries, life totals, and gives the first player priority", () => {
    const g = newGame();
    expect(g.players[alice]?.library).toHaveLength(5);
    expect(g.players[bob]?.life).toBe(20);
    expect(g.priority?.holder).toBe(alice);
  });
});

describe("zones", () => {
  test("moving an object issues a new id and removes the old one", () => {
    const g = newGame();
    const top = g.players[alice]!.library.at(-1)!;
    const moved = moveObject(g, top, "hand")!;
    expect(moved.newId).not.toBe(top);
    expect(moved.state.objects[top]).toBeUndefined();
    expect(moved.state.players[alice]?.hand).toEqual([moved.newId]);
    expect(moved.state.players[alice]?.library).toHaveLength(4);
  });

  test("drawing from an empty library flags the player", () => {
    let g = newGame();
    for (let i = 0; i < 6; i++) g = drawCard(g, bob).state;
    expect(g.players[bob]?.hand).toHaveLength(5);
    expect(g.players[bob]?.drewFromEmptyLibrary).toBe(true);
  });
});

describe("layers", () => {
  test("a +1/+1 effect modifies a creature on the battlefield", () => {
    const g = newGame();
    const top = g.players[alice]!.library.at(-1)!;
    const { state, newId } = moveObject(g, top, "battlefield")!;
    const buff: ContinuousEffect = {
      source: newId,
      timestamp: state.nextId as Timestamp,
      affects: { kind: "object", id: newId },
      modification: { kind: "modifyPT", power: 1, toughness: 1 },
      duration: "untilEndOfTurn",
    };
    const buffed = { ...state, continuousEffects: [buff] };
    expect(getCharacteristics(buffed, newId)).toMatchObject({ power: 3, toughness: 3 });
    expect(getCharacteristics(state, newId)).toMatchObject({ power: 2, toughness: 2 });
  });
});

describe("priority and turn structure", () => {
  test("only the priority holder can pass", () => {
    const result = applyAction(newGame(), { type: "passPriority", player: bob });
    expect(result.ok).toBe(false);
  });

  test("both players passing advances the step", () => {
    let g = newGame();
    for (const player of [alice, bob]) {
      const r = applyAction(g, { type: "passPriority", player });
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.turn.step).toBe("draw");
  });

  test("passing through a full turn starts turn 2, where bob draws", () => {
    let g = newGame();
    for (let i = 0; i < 100 && g.turn.number === 1; i++) {
      const holder = g.priority!.holder;
      const r = applyAction(g, { type: "passPriority", player: holder });
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.turn.number).toBe(2);
    expect(g.turn.activePlayer).toBe(bob);
    expect(g.turn.step).toBe("upkeep");
    // Walk to the draw step and confirm bob drew.
    for (let i = 0; i < 2; i++) {
      const r = applyAction(g, { type: "passPriority", player: g.priority!.holder });
      if (!r.ok) throw new Error(r.error);
      g = r.state;
    }
    expect(g.turn.step).toBe("draw");
    expect(g.players[bob]?.hand).toHaveLength(1);
  });
});

describe("spell targeting", () => {
    test("canceling a targeting decision rolls back the spell cast", () => {
        const g = createGame(
            [bear, targetSpell],
            [
                { id: alice, deck: [targetSpell.id] },
                { id: bob, deck: [bear.id] },
            ],
        );
        const card = g.players[alice]!.library[0]!;
        const moved = moveObject(g, card, "hand")!;
        const cast = applyAction(moved.state, {
            type: "castSpell",
            player: alice,
            card: moved.newId,
            targets: [],
        });
        if (!cast.ok) throw new Error(cast.error);
        const decision = cast.state.pending;
        if (!decision) throw new Error("Expected a target decision");

        const canceled = submitAnswer(cast.state, {
            player: alice,
            decision: decision.id,
            answer: { kind: "cancel" },
        });

        if (!canceled.ok) throw new Error(canceled.error);
        expect(canceled.state.casting).toBeNull();
        expect(canceled.state.players[alice]?.hand).toContain(moved.newId);
        expect(canceled.events).toContainEqual({
            type: "spellCastCancelled",
            player: alice,
            card: moved.newId,
        });
    });

    test("replaying a targeting answer from the same state does not duplicate its target", () => {
        const g = createGame(
            [bear, targetSpell],
            [
                { id: alice, deck: [targetSpell.id] },
                { id: bob, deck: [bear.id] },
            ],
        );
        const card = g.players[alice]!.library[0]!;
        const moved = moveObject(g, card, "hand")!;
        const inHand = moved.state;
        const cardInHand = moved.newId;
        const cast = applyAction(inHand, {
            type: "castSpell",
            player: alice,
            card: cardInHand,
            targets: [],
        });
        if (!cast.ok) throw new Error(cast.error);
        const decision = cast.state.pending;
        if (!decision || decision.kind !== "choose")
            throw new Error("Expected a target decision");
        const submission = {
            player: alice,
            decision: decision.id,
            answer: { kind: "choose" as const, selected: ["player:bob"] },
        };

        const first = submitAnswer(cast.state, submission);
        const second = submitAnswer(cast.state, submission);

        if (!first.ok) throw new Error(first.error);
        if (!second.ok) throw new Error(second.error);
        expect(cast.state.casting?.targets).toEqual([]);
        expect(first.state.casting?.targets).toEqual([
            { kind: "player", id: bob },
        ]);
        expect(second.state.casting?.targets).toEqual([
            { kind: "player", id: bob },
        ]);
    });
});
