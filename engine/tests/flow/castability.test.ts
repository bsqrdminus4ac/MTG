import { describe, expect, test } from "vitest";
import { applyAction, submitAnswer } from "../../src/engine";
import { priorityOptions } from "../../src/flow/priority";
import type { AbilityOfKind, AbilityRef } from "../../src/model/abilities";
import type { CardDefinition } from "../../src/model/cardDefinition";
import { cardDefId, playerId, type ObjectId, type StackId } from "../../src/model/ids";
import { refKey } from "../../src/model/layers";
import type { GameState } from "../../src/model/state";
import { createGame } from "../../src/setup";
import { moveDefinition } from "../helpers";

const alice = playerId("alice");
const bob = playerId("bob");
const freeCost = { generic: 0, pips: [] };
const oneGeneric = { generic: 1, pips: [] };

const creature: CardDefinition = {
    id: cardDefId("castability-creature"),
    name: "Test Creature",
    cost: [{ kind: "mana", cost: freeCost }],
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
    cost: [{ kind: "mana", cost: freeCost }],
    colors: [],
    supertypes: [],
    types: ["Instant"],
    subtypes: [],
    power: null,
    toughness: null,
    abilities: [
        {
            kind: "spell",
            targets: [
                {
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
                    targetName: "creature",
                },
            ],
            effects: [{ kind: "destroy", target: { kind: "target", spec: 0 } }],
            text: "",
        },
    ],
};

const optionalTargetSpell: CardDefinition = {
    ...creatureOnlySpell,
    id: cardDefId("castability-optional-target"),
    name: "Optional Target",
    abilities: [
        {
            kind: "spell",
            targets: [
                {
                    filter: {
                        kind: "object",
                        filter: { kind: "hasType", type: "Creature" },
                    },
                    minCount: 0,
                    maxCount: 1,
                },
            ],
            effects: [],
            text: "",
        },
    ],
};

const unaffordableSpell: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-unaffordable-spell"),
    name: "Unaffordable Spell",
    cost: [{ kind: "mana", cost: oneGeneric }],
    abilities: [{ kind: "spell", targets: [], effects: [], text: "" }],
};

const sorcery: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-sorcery"),
    name: "Test Sorcery",
    types: ["Sorcery"],
    abilities: [{ kind: "spell", targets: [], effects: [], text: "" }],
};

const instant: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-instant"),
    name: "Test Instant",
    abilities: [{ kind: "spell", targets: [], effects: [], text: "" }],
};

const stackSpell: CardDefinition = {
    ...instant,
    id: cardDefId("castability-stack-spell"),
    name: "Stack Spell",
};

const unaffordableAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: [{ kind: "mana", cost: oneGeneric }],
    isManaAbility: false,
    targets: [],
    effects: [],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
    text: "",
};

const unaffordableAbilitySource: CardDefinition = {
    ...creature,
    id: cardDefId("castability-unaffordable-ability"),
    name: "Unaffordable Ability Source",
    abilities: [unaffordableAbility],
};

const selfManaAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: [{ kind: "mana", cost: oneGeneric }, { kind: "tapSelf" }],
    isManaAbility: false,
    targets: [],
    effects: [],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
    text: "",
};

const ownManaSourceAbility: AbilityOfKind<"activated"> = {
    kind: "activated",
    cost: [{ kind: "tapSelf" }],
    isManaAbility: true,
    targets: [],
    effects: [{ kind: "addMana", mana: { kind: "mana", type: "G" }, amount: 1 }],
    activateableZones: ["battlefield"],
    timingRestriction: "instantSpeed",
    text: "",
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
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: [{ kind: "tapSelf" }],
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
            text: "",
        },
    ],
};

const redBlackSpell: CardDefinition = {
    ...optionalTargetSpell,
    id: cardDefId("castability-red-black-spell"),
    name: "Red Black Spell",
    cost: [{ kind: "mana", cost: { generic: 0, pips: ["R", "B"] } }],
    abilities: [{ kind: "spell", targets: [], effects: [], text: "" }],
};

const whiteSpell: CardDefinition = {
    ...redBlackSpell,
    id: cardDefId("castability-white-spell"),
    name: "White Spell",
    cost: [{ kind: "mana", cost: { generic: 0, pips: ["W"] } }],
};

const redSpell: CardDefinition = {
    ...instant,
    id: cardDefId("castability-red-spell"),
    name: "Red Spell",
    colors: ["R"],
};

const whiteColorSpell: CardDefinition = {
    ...instant,
    id: cardDefId("castability-white-color-spell"),
    name: "White Color Spell",
    colors: ["W"],
};

const redSpellRestrictionSource: CardDefinition = {
    ...creature,
    id: cardDefId("castability-red-spell-restriction"),
    name: "Red Spell Restriction",
    types: ["Enchantment"],
    power: null,
    toughness: null,
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            text: "Opponents can't cast red spells.",
            effect: {
                affects: { kind: "matchingPlayers", filter: { kind: "opponent" } },
                modifications: [{ kind: "cantCast", what: { kind: "hasColor", color: "R" } }],
            },
        },
    ],
};

function game(definitions: readonly CardDefinition[], aliceDeck: readonly CardDefinition[], bobDeck: readonly CardDefinition[] = [creature]): GameState {
    return createGame(
        [creature, ...definitions],
        [
            { id: alice, deck: aliceDeck.map(({ id }) => id) },
            { id: bob, deck: bobDeck.map(({ id }) => id) },
        ],
    );
}

function atPrecombatMain(state: GameState): GameState {
    return { ...state, turn: { ...state.turn, step: "precombatMain" } };
}

function offersCast(state: GameState, card: ObjectId): boolean {
    return priorityOptions(state, alice).some((option) => option.action.type === "castSpell" && option.action.card === card);
}

function offersActivation(state: GameState, source: ObjectId, abilityRef: AbilityRef): boolean {
    return priorityOptions(state, alice).some(
        (option) => option.action.type === "activateAbility" && option.action.source === source && refKey(option.action.source, option.action.abilityRef) === refKey(source, abilityRef),
    );
}

describe("castability and activatability options", () => {
    test("offers a creature-only spell only when a creature is on the battlefield", () => {
        const inHand = moveDefinition(game([creature, creatureOnlySpell], [creatureOnlySpell, creature]), alice, creatureOnlySpell, "hand");
        const state = atPrecombatMain(inHand.state);

        expect(offersCast(state, inHand.newId)).toBe(false);

        const creatureOnBattlefield = moveDefinition(state, bob, creature, "battlefield");
        expect(offersCast(creatureOnBattlefield.state, inHand.newId)).toBe(true);
    });

    test("does not offer a creature-only spell when the only opposing creature has hexproof", () => {
        const inHand = moveDefinition(game([hexproofCreature, creatureOnlySpell], [creatureOnlySpell], [hexproofCreature]), alice, creatureOnlySpell, "hand");
        const hexproofOnBattlefield = moveDefinition(inHand.state, bob, hexproofCreature, "battlefield");

        expect(offersCast(atPrecombatMain(hexproofOnBattlefield.state), inHand.newId)).toBe(false);
    });

    test("a static ability prevents casting only spells matching its color restriction", () => {
        let state = game([redSpellRestrictionSource, redSpell, whiteColorSpell], [redSpell, whiteColorSpell], [redSpellRestrictionSource]);
        const redSpellInHand = moveDefinition(state, alice, redSpell, "hand");
        state = redSpellInHand.state;
        const whiteSpellInHand = moveDefinition(state, alice, whiteColorSpell, "hand");
        state = whiteSpellInHand.state;
        const restrictionSource = moveDefinition(state, bob, redSpellRestrictionSource, "battlefield");
        const mainPhase = atPrecombatMain(restrictionSource.state);

        expect(offersCast(mainPhase, redSpellInHand.newId)).toBe(false);
        expect(offersCast(mainPhase, whiteSpellInHand.newId)).toBe(true);
    });

    test("offers an up-to-one-target spell when there are no legal targets", () => {
        const inHand = moveDefinition(game([optionalTargetSpell], [optionalTargetSpell]), alice, optionalTargetSpell, "hand");

        expect(offersCast(atPrecombatMain(inHand.state), inHand.newId)).toBe(true);
    });

    test("does not offer unaffordable spells or abilities", () => {
        let state = game([unaffordableSpell, unaffordableAbilitySource], [unaffordableSpell, unaffordableAbilitySource]);
        const spell = moveDefinition(state, alice, unaffordableSpell, "hand");
        state = spell.state;
        const abilitySource = moveDefinition(state, alice, unaffordableAbilitySource, "battlefield");

        expect(offersCast(atPrecombatMain(abilitySource.state), spell.newId)).toBe(false);
        expect(offersActivation(abilitySource.state, abilitySource.newId, { kind: "printed", index: 0 })).toBe(false);
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
            stack: [
                {
                    kind: "spell",
                    id: spellOnStack.state.nextId as StackId,
                    controller: alice,
                    source: spellOnStack.newId,
                    targets: [],
                    ability: stackCharacteristics.abilities.find((ability): ability is AbilityOfKind<"spell"> => ability.kind === "spell")!,
                    bindings: {},
                },
            ],
        };
        const combatState = {
            ...atPrecombatMain(state),
            turn: { ...state.turn, step: "beginningOfCombat" as const },
        };

        expect(offersCast(combatState, sorceryInHand.newId)).toBe(false);
        expect(offersCast(combatState, instantInHand.newId)).toBe(true);
        expect(offersCast(atPrecombatMain(stackState), sorceryInHand.newId)).toBe(false);
        expect(offersCast(atPrecombatMain(stackState), instantInHand.newId)).toBe(true);
    });

    test("does not offer an ability whose only mana source is its own tapped source", () => {
        const state = game([sharedSourceAbilities], [sharedSourceAbilities]);
        const source = moveDefinition(state, alice, sharedSourceAbilities, "battlefield");

        expect(offersActivation(source.state, source.newId, { kind: "printed", index: 0 })).toBe(false);
    });

    test("considers each decision when checking whether a mana ability can pay a spell cost", () => {
        let state = game([multipleChoiceManaSource, redBlackSpell, whiteSpell], [multipleChoiceManaSource, redBlackSpell, whiteSpell]);
        const source = moveDefinition(state, alice, multipleChoiceManaSource, "battlefield");
        state = source.state;
        const payableSpell = moveDefinition(state, alice, redBlackSpell, "hand");
        state = payableSpell.state;
        const unpayableSpell = moveDefinition(state, alice, whiteSpell, "hand");

        expect(offersCast(atPrecombatMain(unpayableSpell.state), payableSpell.newId)).toBe(true);
        expect(offersCast(atPrecombatMain(unpayableSpell.state), unpayableSpell.newId)).toBe(false);
    });

    test("a creature entering this turn can use a tap ability only if it has haste", () => {
        const state = game([sharedSourceAbilities, hastyTapAbilitySource], [sharedSourceAbilities, hastyTapAbilitySource]);
        const withoutHaste = moveDefinition(state, alice, sharedSourceAbilities, "battlefield");
        const withHaste = moveDefinition(withoutHaste.state, alice, hastyTapAbilitySource, "battlefield");

        expect(withoutHaste.state.objects[withoutHaste.newId]?.turnEnteredZone).toBe(withoutHaste.state.turn.number);
        expect(withHaste.state.objects[withHaste.newId]?.turnEnteredZone).toBe(withHaste.state.turn.number);
        expect(offersActivation(withoutHaste.state, withoutHaste.newId, { kind: "printed", index: 1 })).toBe(false);
        expect(offersActivation(withHaste.state, withHaste.newId, { kind: "printed", index: 1 })).toBe(true);
    });

    test("returns a failure instead of throwing when directly casting an unavailable spell", () => {
        const inHand = moveDefinition(game([creatureOnlySpell], [creatureOnlySpell]), alice, creatureOnlySpell, "hand");
        const state = atPrecombatMain(inHand.state);

        let result: ReturnType<typeof applyAction> | undefined;
        expect(() => {
            result = applyAction(state, { type: "castSpell", player: alice, card: inHand.newId });
        }).not.toThrow();
        expect(result).toMatchObject({ ok: false });
    });

    test("runs state-based actions after casting and before the opponent receives priority", () => {
        let state = game([instant], [instant, creature]);
        const spell = moveDefinition(state, alice, instant, "hand");
        state = spell.state;
        const damagedCreature = moveDefinition(state, bob, creature, "battlefield");
        state = {
            ...atPrecombatMain(damagedCreature.state),
            objects: {
                ...damagedCreature.state.objects,
                [damagedCreature.newId]: {
                    ...damagedCreature.state.objects[damagedCreature.newId]!,
                    damage: 2,
                },
            },
        };

        const startCast = applyAction(state, { type: "castSpell", player: alice, card: spell.newId });
        if (!startCast.ok || startCast.state.pending?.kind !== "yesNo") {
            throw new Error("Expected the spell payment decision");
        }
        const committed = submitAnswer(startCast.state, {
            player: alice,
            decision: startCast.state.pending.id,
            answer: { kind: "yesNo", value: true },
        });
        if (!committed.ok) throw new Error(committed.error);

        expect(committed.state.objects[damagedCreature.newId]).toBeUndefined();
        const creatureMoved = committed.events.find((event) => event.type === "cardMoved" && event.oldId === damagedCreature.newId);
        expect(creatureMoved).toMatchObject({ type: "cardMoved", from: "battlefield" });
        if (creatureMoved?.type !== "cardMoved") throw new Error("Expected the lethal creature to move");
        expect(committed.state.players[bob]?.graveyard).toContain(creatureMoved.newId);

        const passed = applyAction(committed.state, { type: "passPriority", player: alice });
        if (!passed.ok) throw new Error(passed.error);
        expect(passed.state.priority?.holder).toBe(bob);
        expect(passed.state.pending).toMatchObject({ kind: "priority", player: bob });
        expect(passed.state.objects[damagedCreature.newId]).toBeUndefined();
    });
});
