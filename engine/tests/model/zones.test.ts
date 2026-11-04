import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { snapshotSource } from "../../src/model/characteristics";
import { cardDefId, playerId, type Timestamp } from "../../src/model/ids";
import type { ContinuousEffect } from "../../src/model/continuous";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";

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

describe("card movement snapshots", () => {
    test("moving a battlefield creature includes its before snapshot", () => {
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
            before: expectedLki,
        });
        expect(moved.events[0]?.type === "cardMoved" ? moved.events[0].after : undefined).toBeUndefined();
        expect(moved.events[0]?.type === "cardMoved" ? moved.events[0].before?.chars : undefined).toEqual(expectedLki?.chars);
        expect(moved.events[0]?.type === "cardMoved" ? moved.events[0].before?.counters : undefined).toEqual({ "+1/+1": 2, charge: 1 });
    });

    test("moving a card onto the battlefield includes its after snapshot", () => {
        const initial = game();
        const entered = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
        const event = entered.events[0];

        expect(event).toMatchObject({
            type: "cardMoved",
            from: "library",
            to: "battlefield",
            after: {
                id: entered.newId,
                zone: "battlefield",
            },
        });
        if (event?.type !== "cardMoved") throw new Error("Expected a cardMoved event");
        expect(event.before).toBeUndefined();
        expect(event.after).toEqual(snapshotSource(entered.state, entered.newId));
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

        expect(moved.events[0]).toMatchObject({ type: "cardMoved", from, to });
        if (moved.events[0]?.type !== "cardMoved") throw new Error("Expected a cardMoved event");
        expect(moved.events[0].before).toBeUndefined();
        expect(moved.events[0].after).toBeUndefined();
    });
});
