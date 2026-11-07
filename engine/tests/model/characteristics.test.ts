import { describe, expect, test } from "vitest";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { getCharacteristics, hasKeyword } from "../../src/model/characteristics";
import type { GameState } from "../../src/model/state";
import { cardDefId, playerId } from "../../src/model/ids";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { makeContinuousEffect } from "../helpers";

const alice = playerId("characteristics-alice");
const bob = playerId("characteristics-bob");

const creature: CardDefinition = {
    id: cardDefId("characteristics-creature"),
    name: "Characteristics Creature",
    manaCost: { generic: 1, pips: ["G"] },
    colors: ["G"],
    supertypes: [],
    types: ["Creature"],
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
    abilities: [],
};

const artifact: CardDefinition = {
    id: cardDefId("characteristics-artifact"),
    name: "Characteristics Artifact",
    manaCost: { generic: 1, pips: [] },
    colors: [],
    supertypes: [],
    types: ["Artifact"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [],
};

function game(deck: readonly CardDefinition["id"][] = [creature.id, creature.id, artifact.id]): GameState {
    return createGame(
        [creature, artifact],
        [
            { id: alice, deck },
            { id: bob, deck: [] },
        ],
    );
}

function enterBattlefield(state: GameState, id: GameState["battlefield"][number]) {
    const moved = moveObject(state, id, "battlefield");
    if (!moved) throw new Error("Expected card to move to the battlefield");
    return moved;
}

describe("getCharacteristics", () => {
    test("a creature with no effects returns its printed values", () => {
        const state = game();
        const id = state.players[alice]!.library[0]!;

        expect(getCharacteristics(state, id)).toEqual({
            name: creature.name,
            manaCost: creature.manaCost,
            colors: creature.colors,
            supertypes: creature.supertypes,
            types: creature.types,
            subtypes: creature.subtypes,
            power: creature.power,
            toughness: creature.toughness,
            abilities: creature.abilities,
        });
    });

    test("two modifyPT effects on one creature stack", () => {
        const initial = game();
        const entered = enterBattlefield(initial, initial.players[alice]!.library[0]!);
        const [firstState, firstEffect] = makeContinuousEffect(entered.state, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "modifyPT", power: 1, toughness: 2 },
            duration: "permanent",
        });
        const [secondState, secondEffect] = makeContinuousEffect(firstState, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "modifyPT", power: 2, toughness: 1 },
            duration: "permanent",
        });
        const state = { ...secondState, continuousEffects: [firstEffect, secondEffect] };

        expect(getCharacteristics(state, entered.newId)).toMatchObject({ power: 5, toughness: 5 });
    });

    test("later setPT effects override earlier ones and modifyPT applies on top", () => {
        const initial = game();
        const entered = enterBattlefield(initial, initial.players[alice]!.library[0]!);
        const [modifiedState, modifyEffect] = makeContinuousEffect(entered.state, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "modifyPT", power: 1, toughness: 2 },
            duration: "permanent",
        });
        const [setState, earlierSetEffect] = makeContinuousEffect(modifiedState, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "setPT", power: 4, toughness: 5 },
            duration: "permanent",
        });
        const earlierSet = { ...setState, continuousEffects: [modifyEffect, earlierSetEffect] };
        expect(getCharacteristics(earlierSet, entered.newId)).toMatchObject({ power: 5, toughness: 7 });

        const [laterSetState, laterSetEffect] = makeContinuousEffect(earlierSet, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "setPT", power: 7, toughness: 8 },
            duration: "permanent",
        });
        const laterSet = {
            ...laterSetState,
            continuousEffects: [...laterSetState.continuousEffects, laterSetEffect],
        };

        expect(getCharacteristics(laterSet, entered.newId)).toMatchObject({ power: 8, toughness: 10 });
    });

    test("addKeyword makes hasKeyword true and adds the keyword to abilities", () => {
        const initial = game();
        const entered = enterBattlefield(initial, initial.players[alice]!.library[0]!);
        const [effectState, effect] = makeContinuousEffect(entered.state, {
            source: entered.newId,
            controller: alice,
            affects: { kind: "objects", ids: [entered.newId] },
            modification: { kind: "addKeywords", keywords: ["trample"] },
            duration: "permanent",
        });
        const state = { ...effectState, continuousEffects: [effect] };

        expect(hasKeyword(state, entered.newId, "trample")).toBe(true);
        expect(getCharacteristics(state, entered.newId)?.abilities).toContainEqual({
            kind: "keyword",
            keyword: "trample",
        });
    });

    test("allCreatures skips non-creatures and objects outside the battlefield", () => {
        const initial = game();
        const creatureOnBattlefield = enterBattlefield(initial, initial.players[alice]!.library[0]!);
        const artifactOnBattlefield = enterBattlefield(
            creatureOnBattlefield.state,
            creatureOnBattlefield.state.players[alice]!.library[1]!,
        );
        const libraryCreature = artifactOnBattlefield.state.players[alice]!.library[0]!;
        const [effectState, effect] = makeContinuousEffect(artifactOnBattlefield.state, {
            source: creatureOnBattlefield.newId,
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
            duration: "permanent",
        });
        const state = { ...effectState, continuousEffects: [effect] };

        expect(getCharacteristics(state, creatureOnBattlefield.newId)).toMatchObject({ power: 3, toughness: 3 });
        expect(getCharacteristics(state, artifactOnBattlefield.newId)).toMatchObject({ power: null, toughness: null });
        expect(getCharacteristics(state, libraryCreature)).toMatchObject({ power: 2, toughness: 2 });
    });

    test("leaving the battlefield removes old-id effects and effects sourced by that object", () => {
        const initial = game();
        const source = enterBattlefield(initial, initial.players[alice]!.library[0]!);
        const target = enterBattlefield(source.state, source.state.players[alice]!.library[0]!);
        const [targetEffectState, targetEffect] = makeContinuousEffect(target.state, {
            source: target.newId,
            controller: alice,
            affects: { kind: "objects", ids: [source.newId] },
            modification: { kind: "modifyPT", power: 2, toughness: 2 },
            duration: "permanent",
        });
        const [sourceEffectState, sourceEffect] = makeContinuousEffect(targetEffectState, {
            source: source.newId,
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
        const effectedState = {
            ...sourceEffectState,
            continuousEffects: [targetEffect, sourceEffect],
        };

        expect(getCharacteristics(effectedState, source.newId)).toMatchObject({ power: 5, toughness: 5 });
        expect(getCharacteristics(effectedState, target.newId)).toMatchObject({ power: 3, toughness: 3 });

        const leftBattlefield = moveObject(effectedState, source.newId, "graveyard");
        if (!leftBattlefield) throw new Error("Expected card to move to the graveyard");
        expect(leftBattlefield.state.continuousEffects).toEqual([]);
        expect(getCharacteristics(leftBattlefield.state, target.newId)).toMatchObject({ power: 2, toughness: 2 });

        const returned = moveObject(leftBattlefield.state, leftBattlefield.newId, "battlefield");
        if (!returned) throw new Error("Expected card to return to the battlefield");
        expect(getCharacteristics(returned.state, returned.newId)).toMatchObject({ power: 2, toughness: 2 });
        expect(getCharacteristics(returned.state, target.newId)).toMatchObject({ power: 2, toughness: 2 });
    });
});