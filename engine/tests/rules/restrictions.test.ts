import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import type { ObjectMatch } from "../../src/model/continuous";
import { cardDefId, playerId } from "../../src/model/ids";
import type { ObjectPredicate } from "../../src/model/predicates";
import type { GameState } from "../../src/model/state";
import {
    cantAttackDueToRestriction,
    cantBlockDueToRestriction,
    cantCastDueToRestriction,
    cantPlayLandDueToRestriction,
} from "../../src/rules/restrictions";
import { createGame } from "../../src/setup";
import { makeContinuousEffect, moveDefinition } from "../helpers";

const alice = playerId("alice");
const bob = playerId("bob");

const elf: CardDefinition = {
    id: cardDefId("elf"),
    name: "Elf",
    manaCost: null,
    colors: ["G"],
    supertypes: [],
    types: ["Creature"],
    subtypes: ["Elf"],
    power: 1,
    toughness: 1,
    abilities: [],
};

const bear: CardDefinition = {
    ...elf,
    id: cardDefId("bear"),
    name: "Bear",
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
};

const instant: CardDefinition = {
    ...elf,
    id: cardDefId("instant"),
    name: "Instant",
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
};

const objectRestriction: ObjectPredicate = {
    kind: "all",
    of: [
        { kind: "hasType", type: "Creature" },
        { kind: "controlledBy", who: "opponent" },
    ],
};

const objectSource: CardDefinition = {
    ...elf,
    id: cardDefId("object-source"),
    name: "Object Source",
    types: ["Enchantment"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            text: "Restrictions apply to opposing creatures.",
            effect: {
                affects: {
                    kind: "matchingObjects",
                    filter: objectRestriction,
                    zones: ["battlefield"],
                },
                modifications: [
                    { kind: "cantAttack", who: { kind: "player", filter: { kind: "you" } } },
                    { kind: "cantBlock", who: { kind: "hasSubtype", type: "Elf" } },
                ],
            },
        },
    ],
};

const playerSource: CardDefinition = {
    ...objectSource,
    id: cardDefId("player-source"),
    name: "Player Source",
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            text: "Restrictions apply to opponents.",
            effect: {
                affects: { kind: "matchingPlayers", filter: { kind: "opponent" } },
                modifications: [
                    { kind: "cantPlayLands" },
                    { kind: "cantCast", what: { kind: "hasType", type: "Instant" } },
                ],
            },
        },
    ],
};

function gameWithCards(definitions: readonly CardDefinition[]): GameState {
    return createGame(definitions, [
        { id: alice, deck: definitions.flatMap((definition) => [definition.id, definition.id]) },
        { id: bob, deck: definitions.flatMap((definition) => [definition.id, definition.id]) },
    ]);
}

describe("restriction affected sets and predicates", () => {
    test("static object restrictions match the affected set, zone, and target predicates", () => {
        let state = gameWithCards([objectSource, elf, bear]);
        const source = moveDefinition(state, alice, objectSource, "battlefield");
        state = source.state;
        const attackingElf = moveDefinition(state, bob, elf, "battlefield");
        state = attackingElf.state;
        const outOfZoneElf = moveDefinition(state, bob, elf, "hand");
        state = outOfZoneElf.state;
        const blockingBear = moveDefinition(state, bob, bear, "battlefield");
        state = blockingBear.state;
        const attackingBear = moveDefinition(state, alice, bear, "battlefield");
        state = attackingBear.state;
        const elfTarget = moveDefinition(state, alice, elf, "battlefield");
        state = elfTarget.state;
        const bearTarget = moveDefinition(state, alice, bear, "battlefield");
        state = bearTarget.state;

        expect(cantAttackDueToRestriction(state, attackingElf.newId, { kind: "player", id: alice })).toBe(true);
        expect(cantAttackDueToRestriction(state, attackingElf.newId, { kind: "player", id: bob })).toBe(false);
        expect(cantAttackDueToRestriction(state, outOfZoneElf.newId, { kind: "player", id: alice })).toBe(false);
        expect(cantAttackDueToRestriction(state, attackingBear.newId, { kind: "player", id: alice })).toBe(false);
        expect(cantBlockDueToRestriction(state, blockingBear.newId, elfTarget.newId)).toBe(true);
        expect(cantBlockDueToRestriction(state, blockingBear.newId, bearTarget.newId)).toBe(false);
    });

    test("static player restrictions match the affected player and filtered card", () => {
        let state = gameWithCards([playerSource, instant, bear]);
        state = moveDefinition(state, alice, playerSource, "battlefield").state;
        const bobsInstant = moveDefinition(state, bob, instant, "hand");
        state = bobsInstant.state;
        const bobsBear = moveDefinition(state, bob, bear, "hand");
        state = bobsBear.state;
        const alicesInstant = moveDefinition(state, alice, instant, "hand");
        state = alicesInstant.state;

        expect(cantPlayLandDueToRestriction(state, bob)).toBe(true);
        expect(cantPlayLandDueToRestriction(state, alice)).toBe(false);
        expect(cantCastDueToRestriction(state, bob, bobsInstant.newId)).toBe(true);
        expect(cantCastDueToRestriction(state, bob, bobsBear.newId)).toBe(false);
        expect(cantCastDueToRestriction(state, alice, alicesInstant.newId)).toBe(false);
    });

    test("continuous object restrictions use matching-set predicates", () => {
        let state = gameWithCards([objectSource, bear]);
        const source = moveDefinition(state, alice, objectSource, "battlefield");
        state = source.state;
        const opposingBear = moveDefinition(state, bob, bear, "battlefield");
        state = opposingBear.state;

        const affects: ObjectMatch = {
            kind: "matchingObjects",
            filter: objectRestriction,
            zones: ["battlefield"],
        };
        const [effectState, effect] = makeContinuousEffect(state, {
            source: source.newId,
            controller: alice,
            affects,
            modification: { kind: "cantAttack" },
            duration: "permanent",
            sourceName: objectSource.name,
        });
        const restrictedState: GameState = {
            ...effectState,
            continuousEffects: [...effectState.continuousEffects, effect],
        };

        expect(cantAttackDueToRestriction(restrictedState, opposingBear.newId, { kind: "player", id: alice })).toBe(true);
    });
});
