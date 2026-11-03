import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotSource } from "../../src/model/characteristics";
import type { ContinuousEffect } from "../../src/model/continuous";
import { cardDefId, playerId, type Timestamp } from "../../src/model/ids";
import type { ObjectPredicate } from "../../src/model/predicates";
import type { GameState } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { evalObjectPredicate } from "../../src/rules/predicates";
import { createGame } from "../../src/setup";

const alice = playerId("alice");
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

describe("evalPredicate", () => {
    test("a creature made black by a setColors effect does not match nonblack creature", () => {
        const initial = createGame(
            [bear],
            [
                { id: alice, deck: [bear.id] },
                { id: playerId("bob"), deck: [bear.id] },
            ],
        );
        const card = initial.players[alice]!.library[0]!;
        const moved = moveObject(initial, card, "battlefield");
        if (!moved) throw new Error("Expected card to move to the battlefield");

        const nonblackCreature: ObjectPredicate = {
            kind: "all",
            of: [
                { kind: "hasType", type: "Creature" },
                { kind: "not", of: { kind: "hasColor", color: "B" } },
            ],
        };
        const scope = { bindings: {}, controller: alice, source: moved.newId };
        const snap = snapshotSource(moved.state, moved.newId)!;
        expect(evalObjectPredicate(moved.state, scope, snap, nonblackCreature)).toEqual({ ok: true, value: true });

        const colorEffect: ContinuousEffect = {
            source: moved.newId,
            timestamp: moved.state.nextId as Timestamp,
            affects: { kind: "object", id: moved.newId },
            modification: { kind: "setColors", colors: ["B"] },
            duration: "permanent",
        };
        const blackState: GameState = {
            ...moved.state,
            continuousEffects: [...moved.state.continuousEffects, colorEffect],
        };
        const blackSnap = snapshotSource(blackState, moved.newId)!;

        expect(blackSnap.chars.colors).toEqual(["B"]);
        expect(evalObjectPredicate(blackState, scope, blackSnap, nonblackCreature)).toEqual({ ok: true, value: false });
    });
});
