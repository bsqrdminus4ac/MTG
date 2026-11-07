import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { cardDefId, playerId } from "../../src/model/ids";
import type { GameState } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { checkStateBasedActions } from "../../src/rules/stateBasedActions";
import { makeContinuousEffect } from "../helpers";

const alice = playerId("alice");
const bob = playerId("bob");

const lord: CardDefinition = {
    id: cardDefId("sba-test-lord"),
    name: "SBA Test Lord",
    manaCost: { generic: 0, pips: [] },
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: [],
    power: 1,
    toughness: 1,
    abilities: [],
};

const creature: CardDefinition = {
    ...lord,
    id: cardDefId("sba-test-creature"),
    name: "SBA Test Creature",
};

function game(lordFirst: boolean): GameState {
    const initial = createGame([lord, creature], [
        { id: alice, deck: [lord.id, creature.id] },
        { id: bob, deck: [] },
    ]);
    const lordOnBattlefield = moveObject(initial, initial.players[alice]!.library[0]!, "battlefield")!;
    const creatureOnBattlefield = moveObject(lordOnBattlefield.state, lordOnBattlefield.state.players[alice]!.library[0]!, "battlefield")!;
    const [effectState, effect] = makeContinuousEffect(creatureOnBattlefield.state, {
        source: lordOnBattlefield.newId,
        controller: alice,
        affects: {
            kind: "matching",
            filter: {
                kind: "all",
                of: [
                    { kind: "inZone", zone: "battlefield" },
                    { kind: "hasType", type: "Creature" },
                ],
            },
        },
        modification: { kind: "modifyPT", power: 1, toughness: 1 },
        duration: "whileSourceOnBattlefield",
    });
    const state: GameState = {
        ...effectState,
        battlefield: lordFirst
            ? [lordOnBattlefield.newId, creatureOnBattlefield.newId]
            : [creatureOnBattlefield.newId, lordOnBattlefield.newId],
        objects: {
            ...creatureOnBattlefield.state.objects,
            [lordOnBattlefield.newId]: {
                ...creatureOnBattlefield.state.objects[lordOnBattlefield.newId]!,
                damage: 2,
                counters: { "+1/+1": 1 },
            },
            [creatureOnBattlefield.newId]: {
                ...creatureOnBattlefield.state.objects[creatureOnBattlefield.newId]!,
                damage: 2,
                counters: { charge: 3 },
            },
        },
        continuousEffects: [effect],
    };
    return state;
}

describe("state-based action LKI", () => {
    test.each([true, false])("preserves lord buffs for both deaths when lordFirst=%s", (lordFirst) => {
        const initial = game(lordFirst);
        const oldIds = [...initial.battlefield];
        const result = checkStateBasedActions(initial, []);
        if (!result.ok) throw new Error(result.error);

        const movedEvents = result.events.filter((event) => event.type === "cardMoved" && event.from === "battlefield");
        expect(movedEvents).toHaveLength(2);
        for (const id of oldIds) {
            const event = movedEvents.find((moved) => moved.type === "cardMoved" && moved.oldId === id);
            const before = initial.objects[id]!;
            expect(event).toMatchObject({
                type: "cardMoved",
                before: {
                    chars: { power: 2, toughness: 2 },
                    counters: before.counters,
                },
            });
            expect(event?.type === "cardMoved" ? event.after : undefined).toBeUndefined();
        }
    });
});
