import { describe, expect, test } from "vitest";
import { applyAction } from "../engine";
import type { AbilityOfKind } from "../model/abilities";
import type { CardDefinition } from "../model/cardDefinition";
import { cardDefId, playerId, type ObjectId, type StackId } from "../model/ids";
import type { GameState } from "../model/state";
import { moveObject } from "../model/zones";
import { createGame } from "../setup";
import { priorityOptions } from "./priority";

const alice = playerId("alice");
const bob = playerId("bob");
const freeCost = { generic: 0, pips: [] };
const oneGeneric = { generic: 1, pips: [] };

const creature: CardDefinition = {
    id: cardDefId("castability-creature"),
    name: "Test Creature",
    manaCost: freeCost,
    colors: [],
    supertypes: [],
    types: ["Creature"],
    subtypes: [],
    power: 2,
    toughness: 2,
    abilities: [],
};

const hexproofCreature: CardDefinition = {
    ...creature,
    id: cardDefId("castability-hexproof-creature"),
    name: "Hexproof Creature",
    abilities: [{ kind: "keyword", keyword: "hexproof" }],
};

const creatureOnlySpell: CardDefinition = {
    id: cardDefId("castability-destroy-creature"),
    name: "Destroy Creature",
    manaCost: freeCost,
    colors: [],
    supertypes: [],
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [{
        kind: "spell",
        targets: [{
            filter: {
                kind: "object",
                filter: {
                    kind: "all",
                    of: [
                        { kind: "inZone", zone: "battlefield" },
                        { kind: "hasType", type: "Creature" },
                    ],
                },
            },
            minCount: 1,
            maxCount: 1,
            description: "creature",
        }],
        effects: [{ kind: "destroy", target: { kind: "target", spec: 0 } }],
    }],
};

const optionalTargetSpell: CardDefinition = {
    ...creatureOnlySpell,
    id: cardDefId("castability-optional-target"),
    name: "Optional Target",
    abilities: [{
        kind: "spell",
        targets: [{
            filter: {
                kind: "object",
                filter: { kind: "hasType", type: "Creature" },
            },
            minCount: 0,
            maxCount: 1,
        }],
        effects: [],
    }],
};

const unaffordableSpell: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-unaffordable-spell"),
    name: "Unaffordable Spell",
    manaCost: oneGeneric,
    abilities: [{ kind: "spell", targets: [], effects: [] }],
};

const sorcery: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-sorcery"),
    name: "Test Sorcery",
    types: ["Sorcery"],
    abilities: [{ kind: "spell", targets: [], effects: [] }],
};

const instant: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-instant"),
    name: "Test Instant",
    abilities: [{ kind: "spell", targets: [], effects: [] }],
};

const stackSpell: CardDefinition = {
    ...instant,
    id: cardDefId("castability-stack-spell"),
    name: "Stack Spell",
};

const unaffordableAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: { mana: oneGeneric },
    isManaAbility: false,
    targets: [],
    effects: [],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
};

const unaffordableAbilitySource: CardDefinition = {
    ...creature,
    id: cardDefId("castability-unaffordable-ability"),
    name: "Unaffordable Ability Source",
    abilities: [unaffordableAbility],
};

const selfManaAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: { mana: oneGeneric, tap: true },
    isManaAbility: false,
    targets: [],
    effects: [],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
};

const ownManaSourceAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: { tap: true },
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana: { kind: "mana", type: "G" }, amount: 1 }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
};

const sharedSourceAbilities: CardDefinition = {
    ...creature,
    id: cardDefId("castability-shared-mana-source"),
    name: "Shared Mana Source",
    abilities: [selfManaAbility, ownManaSourceAbility],
};

const hastyTapAbilitySource: CardDefinition = {
    ...sharedSourceAbilities,
    id: cardDefId("castability-hasty-tap-source"),
    name: "Hasty Tap Source",
    abilities: [{ kind: "keyword", keyword: "haste" }, ownManaSourceAbility],
};

const multipleChoiceManaSource: CardDefinition = {
    ...creature,
    id: cardDefId("castability-multiple-choice-mana-source"),
    name: "Multiple Choice Mana Source",
    types: ["Artifact"],
    power: null,
    toughness: null,
    abilities: [{
        kind: "activated",
        activateableZones: ["battlefield"],
        cost: { tap: true },
        timingRestriction: "instantSpeed",
        isManaAbility: true,
        targets: [],
        effects: [
            {
                kind: "choose",
                chooser: { kind: "player", who: "controller" },
                from: { kind: "manaType", allowed: ["R", "G"] },
                min: 1,
                max: 1,
                bindAs: "firstMana",
                prompt: "Choose the first mana type",
            },
            {
                kind: "choose",
                chooser: { kind: "player", who: "controller" },
                from: { kind: "manaType", allowed: ["B", "U"] },
                min: 1,
                max: 1,
                bindAs: "secondMana",
                prompt: "Choose the second mana type",
            },
            { kind: "addMana", mana: { kind: "bound", name: "firstMana" }, amount: 1 },
            { kind: "addMana", mana: { kind: "bound", name: "secondMana" }, amount: 1 },
        ],
    }],
};

const redBlackSpell: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-red-black-spell"),
    name: "Red Black Spell",
    manaCost: { generic: 0, pips: ["R", "B"] },
    abilities: [{ kind: "spell", targets: [], effects: [] }],
};

const whiteSpell: CardDefinition = {
    ...redBlackSpell,
    id: cardDefId("castability-white-spell"),
    name: "White Spell",
    manaCost: { generic: 0, pips: ["W"] },
};

function game(
    definitions: readonly CardDefinition[],
    aliceDeck: readonly CardDefinition[],
    bobDeck: readonly CardDefinition[] = [creature],
): GameState {
    return createGame([creature, ...definitions], [
        { id: alice, deck: aliceDeck.map(({ id }) => id) },
        { id: bob, deck: bobDeck.map(({ id }) => id) },
    ]);
}

function moveDefinition(state: GameState, player: typeof alice | typeof bob, definition: CardDefinition, zone: "hand" | "battlefield" | "stack") {
    const card = state.players[player]!.library.find((id) => state.objects[id]?.definitionId === definition.id);
    if (card === undefined) throw new Error(`Missing ${definition.name} in ${player}'s library`);
    const moved = moveObject(state, card, zone);
    if (!moved) throw new Error(`Unable to move ${definition.name}`);
    return { state: moved.state, id: moved.newId };
}

function atPrecombatMain(state: GameState): GameState {
    return { ...state, turn: { ...state.turn, step: "precombatMain" } };
}

function offersCast(state: GameState, card: ObjectId): boolean {
    return priorityOptions(state, alice).some((option) => option.action.type === "castSpell" && option.action.card === card);
}

function offersActivation(state: GameState, source: ObjectId, abilityIndex: number): boolean {
    return priorityOptions(state, alice).some(
        (option) => option.action.type === "activateAbility" && option.action.source === source && option.action.abilityIndex === abilityIndex,
    );
}

describe("castability and activatability options", () => {
    test("offers a creature-only spell only when a creature is on the battlefield", () => {
        const inHand = moveDefinition(game([creature, creatureOnlySpell], [creatureOnlySpell, creature]), alice, creatureOnlySpell, "hand");
        const state = atPrecombatMain(inHand.state);

        expect(offersCast(state, inHand.id)).toBe(false);

        const creatureOnBattlefield = moveDefinition(state, bob, creature, "battlefield");
        expect(offersCast(creatureOnBattlefield.state, inHand.id)).toBe(true);
    });

    test("does not offer a creature-only spell when the only opposing creature has hexproof", () => {
        const inHand = moveDefinition(
            game([hexproofCreature, creatureOnlySpell], [creatureOnlySpell], [hexproofCreature]),
            alice,
            creatureOnlySpell,
            "hand",
        );
        const hexproofOnBattlefield = moveDefinition(inHand.state, bob, hexproofCreature, "battlefield");

        expect(offersCast(atPrecombatMain(hexproofOnBattlefield.state), inHand.id)).toBe(false);
    });

    test("offers an up-to-one-target spell when there are no legal targets", () => {
        const inHand = moveDefinition(game([optionalTargetSpell], [optionalTargetSpell]), alice, optionalTargetSpell, "hand");

        expect(offersCast(atPrecombatMain(inHand.state), inHand.id)).toBe(true);
    });

    test("does not offer unaffordable spells or abilities", () => {
        let state = game(
            [unaffordableSpell, unaffordableAbilitySource],
            [unaffordableSpell, unaffordableAbilitySource],
        );
        const spell = moveDefinition(state, alice, unaffordableSpell, "hand");
        state = spell.state;
        const abilitySource = moveDefinition(state, alice, unaffordableAbilitySource, "battlefield");

        expect(offersCast(atPrecombatMain(abilitySource.state), spell.id)).toBe(false);
        expect(offersActivation(abilitySource.state, abilitySource.id, 0)).toBe(false);
    });

    test("offers instants but not sorceries during combat or while the stack is non-empty", () => {
        let state = game([sorcery, instant, stackSpell], [sorcery, instant, stackSpell]);
        const sorceryInHand = moveDefinition(state, alice, sorcery, "hand");
        state = sorceryInHand.state;
        const instantInHand = moveDefinition(state, alice, instant, "hand");
        state = instantInHand.state;
        const spellOnStack = moveDefinition(state, alice, stackSpell, "stack");
        const stackCharacteristics = spellOnStack.state.definitions[stackSpell.id]!;
        const stackState: GameState = {
            ...spellOnStack.state,
            stack: [{
                kind: "spell",
                id: spellOnStack.state.nextId as StackId,
                controller: alice,
                source: spellOnStack.id,
                targets: [],
                ability: stackCharacteristics.abilities.find((ability): ability is AbilityOfKind<"spell"> => ability.kind === "spell")!,
                bindings: {},
            }],
        };
        const combatState = {
            ...atPrecombatMain(state),
            turn: { ...state.turn, step: "beginningOfCombat" as const },
        };

        expect(offersCast(combatState, sorceryInHand.id)).toBe(false);
        expect(offersCast(combatState, instantInHand.id)).toBe(true);
        expect(offersCast(atPrecombatMain(stackState), sorceryInHand.id)).toBe(false);
        expect(offersCast(atPrecombatMain(stackState), instantInHand.id)).toBe(true);
    });

    test("does not offer an ability whose only mana source is its own tapped source", () => {
        const state = game([sharedSourceAbilities], [sharedSourceAbilities]);
        const source = moveDefinition(state, alice, sharedSourceAbilities, "battlefield");

        expect(offersActivation(source.state, source.id, 0)).toBe(false);
    });

    test("considers each decision when checking whether a mana ability can pay a spell cost", () => {
        let state = game(
            [multipleChoiceManaSource, redBlackSpell, whiteSpell],
            [multipleChoiceManaSource, redBlackSpell, whiteSpell],
        );
        const source = moveDefinition(state, alice, multipleChoiceManaSource, "battlefield");
        state = source.state;
        const payableSpell = moveDefinition(state, alice, redBlackSpell, "hand");
        state = payableSpell.state;
        const unpayableSpell = moveDefinition(state, alice, whiteSpell, "hand");

        expect(offersCast(atPrecombatMain(unpayableSpell.state), payableSpell.id)).toBe(true);
        expect(offersCast(atPrecombatMain(unpayableSpell.state), unpayableSpell.id)).toBe(false);
    });

    test("a creature entering this turn can use a tap ability only if it has haste", () => {
        const state = game(
            [sharedSourceAbilities, hastyTapAbilitySource],
            [sharedSourceAbilities, hastyTapAbilitySource],
        );
        const withoutHaste = moveDefinition(state, alice, sharedSourceAbilities, "battlefield");
        const withHaste = moveDefinition(withoutHaste.state, alice, hastyTapAbilitySource, "battlefield");

        expect(withoutHaste.state.objects[withoutHaste.id]?.turnEnteredZone).toBe(withoutHaste.state.turn.number);
        expect(withHaste.state.objects[withHaste.id]?.turnEnteredZone).toBe(withHaste.state.turn.number);
        expect(offersActivation(withoutHaste.state, withoutHaste.id, 1)).toBe(false);
        expect(offersActivation(withHaste.state, withHaste.id, 1)).toBe(true);
    });

    test("returns a failure instead of throwing when directly casting an unavailable spell", () => {
        const inHand = moveDefinition(game([creatureOnlySpell], [creatureOnlySpell]), alice, creatureOnlySpell, "hand");
        const state = atPrecombatMain(inHand.state);

        let result: ReturnType<typeof applyAction> | undefined;
        expect(() => {
            result = applyAction(state, { type: "castSpell", player: alice, card: inHand.id });
        }).not.toThrow();
        expect(result).toMatchObject({ ok: false });
    });
});
