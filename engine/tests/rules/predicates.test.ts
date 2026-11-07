import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotSource } from "../../src/model/characteristics";
import { cardDefId, playerId } from "../../src/model/ids";
import { evalObjectPredicate } from "../../src/model/objectPredicates";
import type { ObjectPredicate } from "../../src/model/predicates";
import type { GameState } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { makeContinuousEffect } from "../helpers";

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
        expect(evalObjectPredicate(scope, snap, nonblackCreature)).toEqual({ ok: true, value: true });

        const [effectState, colorEffect] = makeContinuousEffect(moved.state, {
            source: moved.newId,
            affects: { kind: "object", id: moved.newId },
            modification: { kind: "setColors", colors: ["B"] },
            duration: "permanent",
        });
        const blackState: GameState = {
            ...effectState,
            continuousEffects: [...effectState.continuousEffects, colorEffect],
        };
        const blackSnap = snapshotSource(blackState, moved.newId)!;

        expect(blackSnap.chars.colors).toEqual(["B"]);
        expect(evalObjectPredicate(scope, blackSnap, nonblackCreature)).toEqual({ ok: true, value: false });
    });
});
