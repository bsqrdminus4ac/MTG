import { describe, expect, test } from "vitest";
import { stabilize } from "../../src/flow/priority";
import type { Ability } from "../../src/model/abilities";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { getCharacteristics, hasKeyword } from "../../src/model/characteristics";
import type { Modification, ObjectMatch } from "../../src/model/continuous";
import { cardDefId, playerId } from "../../src/model/ids";
import type { ObjectPredicate } from "../../src/model/predicates";
import type { GameState } from "../../src/model/state";
import { moveObject } from "../../src/model/zones";
import { createGame } from "../../src/setup";
import { makeContinuousEffect } from "../helpers";

const alice = playerId("layers-alice");
const bob = playerId("layers-bob");

const battlefieldCreatures: ObjectPredicate = {
    kind: "all",
    of: [
        { kind: "inZone", zone: "battlefield" },
        { kind: "hasType", type: "Creature" },
    ],
};

function controlledCreaturesExceptSource(): ObjectMatch {
    return {
        kind: "matching",
        filter: {
            kind: "all",
            of: [
                battlefieldCreatures,
                { kind: "controlledBy", who: "you" },
                { kind: "not", of: { kind: "isSource" } },
            ],
        },
    };
}

function creatureDefinition(
    id: string,
    power = 2,
    toughness = 2,
    abilities: Ability[] = [],
): CardDefinition {
    return {
        id: cardDefId(id),
        name: id,
        manaCost: { generic: 0, pips: [] },
        colors: [],
        supertypes: [],
        types: ["Creature"],
        subtypes: [],
        power,
        toughness,
        abilities,
    };
}

function staticPermanent(id: string, modification: Modification): CardDefinition {
    const staticAbility: Ability = {
        kind: "static",
        activeZones: ["battlefield"],
        effect: {
            affects: {
                kind: "matching",
                filter: {
                    kind: "all",
                    of: [battlefieldCreatures, { kind: "controlledBy", who: "you" }],
                },
            },
            modifications: [modification],
        },
        text: "",
    };
    return {
        id: cardDefId(id),
        name: id,
        manaCost: { generic: 0, pips: [] },
        colors: [],
        supertypes: [],
        types: ["Enchantment"],
        subtypes: [],
        power: null,
        toughness: null,
        abilities: [staticAbility],
    };
}

function newGame(
    definitions: readonly CardDefinition[],
    aliceDeck: readonly CardDefinition["id"][],
    bobDeck: readonly CardDefinition["id"][] = [],
): GameState {
    return createGame(definitions, [
        { id: alice, deck: aliceDeck },
        { id: bob, deck: bobDeck },
    ]);
}

function enterFromLibrary(state: GameState, player = alice) {
    const card = state.players[player]!.library[0]!;
    const moved = moveObject(state, card, "battlefield");
    if (!moved) throw new Error("Expected card to move to the battlefield");
    return moved;
}

describe("characteristic layers", () => {
    test("a creature with no effects returns its printed values", () => {
        const creature = creatureDefinition("layers-printed-creature");
        const state = newGame([creature], [creature.id]);
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
        const creature = creatureDefinition("layers-stacking-creature");
        const entered = enterFromLibrary(newGame([creature], [creature.id]));
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

        expect(getCharacteristics({ ...secondState, continuousEffects: [firstEffect, secondEffect] }, entered.newId))
            .toMatchObject({ power: 5, toughness: 5 });
    });

    test("later setPT effects override earlier ones and modifyPT applies on top", () => {
        const creature = creatureDefinition("layers-set-stack-creature");
        const entered = enterFromLibrary(newGame([creature], [creature.id]));
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
        const creature = creatureDefinition("layers-keyword-creature");
        const entered = enterFromLibrary(newGame([creature], [creature.id]));
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
        const creature = creatureDefinition("layers-filtered-creature");
        const artifact: CardDefinition = {
            id: cardDefId("layers-filtered-artifact"),
            name: "Layers Filtered Artifact",
            manaCost: { generic: 1, pips: [] },
            colors: [],
            supertypes: [],
            types: ["Artifact"],
            subtypes: [],
            power: null,
            toughness: null,
            abilities: [],
        };
        const initial = newGame([creature, artifact], [creature.id, artifact.id, creature.id]);
        const creatureOnBattlefield = enterFromLibrary(initial);
        const artifactOnBattlefield = enterFromLibrary(creatureOnBattlefield.state);
        const libraryCreature = artifactOnBattlefield.state.players[alice]!.library[0]!;
        const [effectState, effect] = makeContinuousEffect(artifactOnBattlefield.state, {
            source: creatureOnBattlefield.newId,
            controller: alice,
            affects: {
                kind: "matching",
                filter: battlefieldCreatures,
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
        const creature = creatureDefinition("layers-leaving-creature");
        const initial = newGame([creature], [creature.id, creature.id]);
        const source = enterFromLibrary(initial);
        const target = enterFromLibrary(source.state);
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
                filter: battlefieldCreatures,
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

    test("an anthem buffs only creatures its controller controls and stops when it leaves", () => {
        const creature = creatureDefinition("layers-anthem-creature");
        const anthem = staticPermanent("layers-anthem", { kind: "modifyPT", power: 1, toughness: 1 });
        let state = newGame([creature, anthem], [anthem.id, creature.id], [creature.id]);
        const anthemInPlay = enterFromLibrary(state);
        const aliceCreature = enterFromLibrary(anthemInPlay.state);
        const bobCreature = enterFromLibrary(aliceCreature.state, bob);
        state = bobCreature.state;

        expect(getCharacteristics(state, aliceCreature.newId)).toMatchObject({ power: 3, toughness: 3 });
        expect(getCharacteristics(state, bobCreature.newId)).toMatchObject({ power: 2, toughness: 2 });

        const movedAnthem = moveObject(state, anthemInPlay.newId, "graveyard");
        if (!movedAnthem) throw new Error("Expected anthem to move to the graveyard");
        expect(getCharacteristics(movedAnthem.state, aliceCreature.newId)).toMatchObject({ power: 2, toughness: 2 });
    });

    test("\"other creatures you control\" does not buff its own source", () => {
        const otherCreature = creatureDefinition("layers-other-creature", 1, 1);
        const staticAbility: Ability = {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: controlledCreaturesExceptSource(),
                modifications: [{ kind: "modifyPT", power: 1, toughness: 1 }],
            },
            text: "",
        };
        const lord = creatureDefinition("layers-lord", 2, 2, [staticAbility]);
        let state = newGame([lord, otherCreature], [lord.id, otherCreature.id]);
        const source = enterFromLibrary(state);
        const target = enterFromLibrary(source.state);
        state = target.state;

        expect(getCharacteristics(state, source.newId)).toMatchObject({ power: 2, toughness: 2 });
        expect(getCharacteristics(state, target.newId)).toMatchObject({ power: 2, toughness: 2 });
    });

    test("a 0/0 sustained by an anthem dies when stabilization follows the anthem leaving", () => {
        const zeroCreature = creatureDefinition("layers-zero-creature", 0, 0);
        const anthem = staticPermanent("layers-sba-anthem", { kind: "modifyPT", power: 1, toughness: 1 });
        let state = newGame([zeroCreature, anthem], [anthem.id, zeroCreature.id]);
        const anthemInPlay = enterFromLibrary(state);
        const creatureInPlay = enterFromLibrary(anthemInPlay.state);
        state = creatureInPlay.state;

        expect(getCharacteristics(state, creatureInPlay.newId)).toMatchObject({ power: 1, toughness: 1 });

        const movedAnthem = moveObject(state, anthemInPlay.newId, "graveyard");
        if (!movedAnthem) throw new Error("Expected anthem to move to the graveyard");
        const stabilized = stabilize(movedAnthem.state, movedAnthem.events);
        expect(stabilized.result.ok).toBe(true);
        if (!stabilized.result.ok) throw new Error(stabilized.result.error);

        expect(stabilized.result.state.objects[creatureInPlay.newId]).toBeUndefined();
        const creatureDeath = stabilized.result.events.find(
            (event) => event.type === "cardMoved" && event.oldId === creatureInPlay.newId,
        );
        expect(creatureDeath).toMatchObject({ type: "cardMoved", from: "battlefield", to: "graveyard" });
        if (creatureDeath?.type !== "cardMoved") throw new Error("Expected the creature to die");
        expect(stabilized.result.state.players[alice]!.graveyard).toContain(creatureDeath.newId);
    });

    test.each([
        [{ "+1/+1": 1 }, 3],
        [{ "+1/+1": 1, "-1/-1": 1 }, 2],
    ])("plus/minus counters adjust power and toughness: %j", (counters, expected) => {
        const creature = creatureDefinition("layers-counter-creature");
        const entered = enterFromLibrary(newGame([creature], [creature.id]));
        const state: GameState = {
            ...entered.state,
            objects: {
                ...entered.state.objects,
                [entered.newId]: { ...entered.state.objects[entered.newId]!, counters },
            },
        };

        expect(getCharacteristics(state, entered.newId)).toMatchObject({ power: expected, toughness: expected });
    });

    test.each([
        ["anthem first", ["modifyPT", "setPT"]],
        ["set effect first", ["setPT", "modifyPT"]],
    ] as const)("setPT happens before the anthem regardless of timestamps (%s)", (_label, order) => {
        const creature = creatureDefinition("layers-set-modify-creature");
        const entered = enterFromLibrary(newGame([creature], [creature.id]));
        let state = entered.state;
        const effects = [];
        for (const kind of order) {
            const modification: Modification =
                kind === "setPT"
                    ? { kind, power: 1, toughness: 1 }
                    : { kind, power: 1, toughness: 1 };
            const [nextState, effect] = makeContinuousEffect(state, {
                source: entered.newId,
                controller: alice,
                affects: { kind: "objects", ids: [entered.newId] },
                modification,
                duration: "permanent",
            });
            state = nextState;
            effects.push(effect);
        }

        expect(getCharacteristics({ ...state, continuousEffects: effects }, entered.newId)).toMatchObject({ power: 2, toughness: 2 });
    });

    test("static effects in a layer use timestamps, including a new timestamp after re-entry", () => {
        const five = staticPermanent("layers-set-five", { kind: "setPT", power: 5, toughness: 5 });
        const three = staticPermanent("layers-set-three", { kind: "setPT", power: 3, toughness: 3 });
        const creature = creatureDefinition("layers-timestamp-creature");
        let state = newGame([five, three, creature], [five.id, three.id, creature.id]);
        const olderFive = enterFromLibrary(state);
        const newerThree = enterFromLibrary(olderFive.state);
        const target = enterFromLibrary(newerThree.state);
        state = target.state;

        expect(getCharacteristics(state, target.newId)).toMatchObject({ power: 3, toughness: 3 });

        const inGraveyard = moveObject(state, olderFive.newId, "graveyard");
        if (!inGraveyard) throw new Error("Expected first permanent to leave the battlefield");
        const returnedFive = moveObject(inGraveyard.state, inGraveyard.newId, "battlefield");
        if (!returnedFive) throw new Error("Expected permanent to return to the battlefield");

        expect(returnedFive.state.objects[returnedFive.newId]!.timestamp).toBeGreaterThan(
            returnedFive.state.objects[newerThree.newId]!.timestamp,
        );
        expect(getCharacteristics(returnedFive.state, target.newId)).toMatchObject({ power: 5, toughness: 5 });
    });

    test("a flying lord grants flying in abilities and hasKeyword to other creatures", () => {
        const staticAbility: Ability = {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: controlledCreaturesExceptSource(),
                modifications: [{ kind: "addKeywords", keywords: ["flying"] }],
            },
            text: "",
        };
        const lord = creatureDefinition("layers-flying-lord", 2, 2, [staticAbility]);
        const otherCreature = creatureDefinition("layers-flying-target", 1, 1);
        let state = newGame([lord, otherCreature], [lord.id, otherCreature.id]);
        const source = enterFromLibrary(state);
        const target = enterFromLibrary(source.state);
        state = target.state;

        expect(getCharacteristics(state, target.newId)?.abilities).toContainEqual({ kind: "keyword", keyword: "flying" });
        expect(hasKeyword(state, target.newId, "flying")).toBe(true);
    });

    test("10,000 characteristic reads across 40 objects use the cache", () => {
        const creature = creatureDefinition("layers-cache-creature");
        let state = newGame([creature], Array.from({ length: 40 }, () => creature.id));
        for (let i = 0; i < 40; i++) state = enterFromLibrary(state).state;
        const ids = state.battlefield;

        expect(getCharacteristics(state, ids[0]!)).not.toBeNull();
        const start = Date.now();
        for (let i = 0; i < 10_000; i++) {
            expect(getCharacteristics(state, ids[i % ids.length]!)).not.toBeNull();
        }
        expect(Date.now() - start).toBeLessThan(1_000);
    });
});
