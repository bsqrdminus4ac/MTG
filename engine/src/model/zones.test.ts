import { describe, expect, test } from "vitest";
import type { CardDefinition } from "./cardDefinition";
import { snapshotSource } from "./characteristics";
import { cardDefId, playerId, type Timestamp } from "./ids";
import type { ContinuousEffect } from "./continuous";
import { moveObject } from "./zones";
import { createGame } from "../setup";

const alice = playerId("alice");
const bob = playerId("bob");

const creature: CardDefinition = {
    id: cardDefId("zones-test-creature"),
    name: "Zones Test Creature",
    manaCost: { generic: 0, pips: [] },
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: [],
    power: 2,
    toughness: 2,
    abilities: [],
};

function game() {
    return createGame([creature], [
        { id: alice, deck: [creature.id, creature.id] },
        { id: bob, deck: [] },
    ]);
}

describe("card movement LKI", () => {
    test("moving a battlefield creature includes its pre-move characteristics and counters", () => {
        const initial = game();
        const entered = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const before = entered.state.objects[entered.newId]!;
        const effect: ContinuousEffect = {
            source: entered.newId,
            timestamp: entered.state.nextId as Timestamp,
            affects: { kind: "object", id: entered.newId },
            modification: { kind: "modifyPT", power: 1, toughness: 1 },
            duration: "whileSourceOnBattlefield",
        };
        const battlefield = {
            ...entered.state,
            objects: {
                ...entered.state.objects,
                [entered.newId]: { ...before, counters: { "+1/+1": 2, charge: 1 } },
            },
            continuousEffects: [effect],
        };
        const expectedLki = snapshotSource(battlefield, entered.newId);
        const moved = moveObject(battlefield, entered.newId, "graveyard")!;

        expect(moved.events[0]).toMatchObject({
            type: "cardMoved",
            from: "battlefield",
            lki: expectedLki,
        });
        expect(moved.events[0]?.type === "cardMoved" ? moved.events[0].lki?.chars : undefined).toEqual(expectedLki?.chars);
        expect(moved.events[0]?.type === "cardMoved" ? moved.events[0].lki?.counters : undefined).toEqual({ "+1/+1": 2, charge: 1 });
    });

    test.each([
        ["library", "hand"],
        ["hand", "graveyard"],
    ] as const)("moving a card from %s has no LKI", (from, to) => {
        const initial = game();
        const firstCard = initial.players[alice]!.library[0]!;
        const inHand = from === "hand" ? moveObject(initial, firstCard, "hand")! : undefined;
        const state = inHand?.state ?? initial;
        const card = inHand?.newId ?? firstCard;
        const moved = moveObject(state, card, to)!;

        expect(moved.events[0]).toMatchObject({ type: "cardMoved", from, to, lki: undefined });
    });
});
