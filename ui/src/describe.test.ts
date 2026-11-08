import { bolt, forest, gloriousAnthem, grove, skeins, wingSplicer } from "@mtg/definitions";
import { type GameState, type ObjectId } from "@mtg/engine";
import { describe, expect, test } from "vitest";
import { ALICE, newDemoGame } from "./demo";
import { describeAbility, describeCardText, describeEffect, describeEffects, describeEvent, describeEventPredicate, describeManaCost, describeModification, describePool, findProblems } from "./describe";

describe("text describers", () => {
    test("mana costs", () => {
        expect(describeManaCost(null)).toBe("—");
        expect(describeManaCost({ generic: 1, pips: ["G"] })).toBe("{1}{G}");
        expect(describeManaCost({ generic: 0, pips: ["R"] })).toBe("{R}");
        expect(describeManaCost({ generic: 0, pips: [] })).toBe("{0}");
    });

    test("mana pools only list what is in them", () => {
        expect(describePool({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 })).toBe("empty");
        expect(describePool({ W: 0, U: 0, B: 0, R: 2, G: 1, C: 0 })).toBe("{R}×2 {G}×1");
    });

    test("abilities", () => {
        expect(describeAbility({ kind: "keyword", keyword: "flying" })).toBe("Keyword: flying");
        expect(describeCardText({ kind: "keyword", keyword: "firstStrike" })).toEqual(["First strike"]);
        expect(
            describeCardText(
                {
                    kind: "spell",
                    targets: [],
                    effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1, description: "<this> gains life." }],
                },
                "Healing Light",
            ),
        ).toEqual(["Healing Light gains life."]);
        expect(describeAbility(forest.abilities[0]!)).toBe("Mana ability: {T} → add 1× {G}");
        expect(describeAbility(bolt.abilities[0]!)).toBe("Spell targeting 1 player or object: deal 3 damage to target 1");
    });

    test("modifications", () => {
        expect(describeModification({ kind: "setTypes", types: ["Artifact", "Creature"] })).toBe("becomes Artifact and Creature");
        expect(describeModification({ kind: "addTypes", types: ["Artifact"] })).toBe("also becomes Artifact");
        expect(describeModification({ kind: "addSubtypes", types: ["Elf", "Druid"] })).toBe("gains subtypes Elf and Druid");
        expect(describeModification({ kind: "addColors", colors: ["U", "R"] })).toBe("gains UR colors");
        expect(describeModification({ kind: "addKeywords", keywords: ["flying", "trample"] })).toBe("gains flying and trample");
        expect(describeModification({ kind: "removeKeywords", keywords: ["flying"] })).toBe("loses flying");
        expect(describeModification({ kind: "switchPT" })).toBe("switches power and toughness");
    });

    test("static abilities describe their affected objects and all modifications", () => {
        expect(describeAbility(gloriousAnthem.abilities[0])).toBe(
            "Static: an object that is in battlefield and is a creature and is controlled by you: +1/+1",
        );
        expect(describeAbility(wingSplicer.abilities[0])).toBe(
            "Static: an object that is in battlefield and is a creature and is controlled by you and does not match this object: gains flying",
        );
        expect(
            describeAbility({
                kind: "static",
                activeZones: ["battlefield"],
                effect: {
                    affects: { kind: "self" },
                    modifications: [
                        { kind: "modifyPT", power: 1, toughness: 1 },
                        { kind: "addKeywords", keywords: ["vigilance"] },
                    ],
                    description: "This creature gets +1/+1 and has vigilance.",
                },
            }),
        ).toBe("Static: This creature gets +1/+1 and has vigilance.");
    });

    test("describes event predicates for triggered abilities", () => {
        expect(
            describeAbility({
                kind: "triggered",
                trigger: {
                    event: "cardMoved",
                    when: {
                        kind: "cardMoved",
                        object: {
                            kind: "all",
                            of: [
                                { kind: "hasType", type: "Creature" },
                                { kind: "controlledBy", who: "you" },
                            ],
                        },
                        from: "battlefield",
                        to: "graveyard",
                    },
                },
                targets: [],
                effects: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1 }],
                triggerableZones: ["battlefield"],
            }),
        ).toBe("Triggered: Whenever an object that is a creature and is controlled by you moves from battlefield to graveyard → you gain 1 life");

        expect(
            describeAbility({
                kind: "triggered",
                trigger: {
                    event: "cardDrawn",
                    when: { kind: "cardDrawn", player: { kind: "you" } },
                    interveningIf: { kind: "compare", left: 2, op: ">=", right: 1 },
                },
                targets: [],
                effects: [],
                triggerableZones: ["battlefield"],
            }),
        ).toBe("Triggered: Whenever you draw a card if 2 >= 1 → do nothing");
    });

    test("describes each event predicate and its qualifiers", () => {
        expect(
            describeEventPredicate({
                kind: "damageDealt",
                target: { kind: "hasType", type: "Creature" },
                source: { kind: "hasColor", color: "R" },
                amount: { op: ">=", value: 3 },
                isCombatDamage: true,
            }),
        ).toBe("Whenever an object that is a creature is dealt at least 3 damage by an object that is red as combat damage");
        expect(describeEventPredicate({ kind: "stepStarted", step: "upkeep", player: { kind: "you" } })).toBe("At the beginning of your upkeep");
        expect(
            describeEventPredicate({
                kind: "spellCast",
                by: { kind: "opponent" },
                spell: { kind: "hasType", type: "Instant" },
            }),
        ).toBe("Whenever an opponent casts an object that is an instant");
        expect(
            describeEventPredicate({
                kind: "abilityActivated",
                by: { kind: "you" },
                source: { kind: "isSource" },
            }),
        ).toBe("Whenever you activate an ability of this object");
        expect(
            describeEventPredicate({
                kind: "lifeChanged",
                player: { kind: "you" },
                delta: { op: ">=", value: 2 },
            }),
        ).toBe("Whenever your life total changes by a value at least +2");
        expect(
            describeEventPredicate({
                kind: "attackDeclared",
                player: { kind: "you" },
                attacker: { kind: "hasType", type: "Creature" },
            }),
        ).toBe("Whenever you attack with an object that is a creature");
        expect(
            describeEventPredicate({
                kind: "blockDeclared",
                player: { kind: "opponent" },
                blocker: { kind: "hasKeyword", keyword: "flying" },
                attacker: { kind: "hasType", type: "Creature" },
            }),
        ).toBe("Whenever an opponent blocks with an object that has flying, blocking an object that is a creature");
        expect(describeEventPredicate({ kind: "cardDrawn" })).toBe("Whenever a player draws a card");
    });

    test("describes boolean event predicate combinations", () => {
        expect(
            describeEventPredicate({
                kind: "all",
                of: [
                    { kind: "cardMoved", from: "battlefield" },
                    { kind: "cardDrawn", player: { kind: "opponent" } },
                ],
            }),
        ).toBe("Whenever an event matches all of: a card moves from battlefield and an opponent draws a card");
        expect(
            describeEventPredicate({
                kind: "not",
                of: { kind: "spellCast", by: { kind: "you" } },
            }),
        ).toBe("Whenever an event does not match: you cast a spell");
    });

    test("describes continuous effect creation and expiration events", () => {
        const state = newDemoGame();
        expect(
            describeEvent(state, {
                type: "continuousEffectCreated",
                modType: "locked",
                sourceName: "Giant Growth",
                duration: "untilEndOfTurn",
                description: "Target creature gets +3/+3.",
            }),
        ).toBe("Continuous effect from Giant Growth created (locked; until end of turn): Target creature gets +3/+3.");
        expect(
            describeEvent(state, {
                type: "continuousEffectExpired",
                sourceName: undefined,
                duration: "whileSourceOnBattlefield",
                description: undefined,
            }),
        ).toBe("Continuous effect expired (while its source remains on the battlefield)");
    });

    test("target descriptions use custom text or fall back to the filter kind", () => {
        expect(
            describeAbility({
                kind: "spell",
                targets: [
                    {
                        filter: {
                            kind: "anyOf",
                            of: [
                                { kind: "player", filter: { kind: "opponent" } },
                                { kind: "object", filter: { kind: "hasType", type: "Creature" } },
                            ],
                        },
                        minCount: 1,
                        maxCount: 1,
                    },
                    {
                        filter: { kind: "object", filter: { kind: "hasType", type: "Creature" } },
                        minCount: 2,
                        maxCount: 2,
                        description: "creature",
                    },
                ],
                effects: [],
            }),
        ).toBe("Spell targeting 1 player or object, 2 creatures: do nothing");
    });

    test("expands loop effects and describes their bound values", () => {
        const ability = skeins.abilities[0];
        const effect = ability?.kind === "spell" ? ability.effects[0] : undefined;

        expect(effect).toBeDefined();
        expect(describeEffect(effect!)).toBe("For each player, Choice: Discard a card; the cards selected by the choice are discarded from their owner's hand");
    });

    test("describes mana added using a chosen mana type", () => {
        expect(
            describeEffects([
                {
                    kind: "choose",
                    chooser: { kind: "player", who: "controller" },
                    from: { kind: "manaType", allowed: ["R", "G"] },
                    min: 1,
                    max: 1,
                    bindAs: "chosenManaType",
                    prompt: "Add {R} or {G}.",
                },
                { kind: "addMana", mana: { kind: "bound", name: "chosenManaType" }, amount: 1 },
            ]),
        ).toBe("Choice: Add {R} or {G}.; add 1× the chosen mana type");
    });

    test("describes a mana ability that adds a chosen mana type", () => {
        expect(describeAbility(grove.abilities[1])).toBe(
            "Mana ability: {T} → Choice: Add {R} or {G}. Each opponent gains 1 life.; add 1× the chosen mana type; For each opponent, that opponent gains 1 life",
        );
    });

    test("describes conditional branches and the yes/no answer they depend on", () => {
        expect(
            describeEffects([
                { kind: "askYesNo", who: { kind: "player", who: "controller" }, prompt: "Gain life?", bindAs: "accepted" },
                {
                    kind: "if",
                    condition: { kind: "flag", name: "accepted" },
                    then: [{ kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 2 }],
                    else: [{ kind: "loseLife", who: { kind: "player", who: "controller" }, amount: 1 }],
                },
            ]),
        ).toBe("Gain life?; If the answer to “Gain life?” is yes, you gain 2 life; otherwise, you lose 1 life");
    });
});

describe("findProblems", () => {
    test("finds nothing wrong with a fresh game", () => {
        expect(findProblems(newDemoGame())).toEqual([]);
    });

    test("reports a zone that lists an object that doesn't exist", () => {
        const game = newDemoGame();
        const missing = game.players[ALICE]!.hand[0]!;
        const objects = Object.fromEntries(Object.entries(game.objects).filter(([id]) => Number(id) !== missing)) as GameState["objects"];

        const problems = findProblems({ ...game, objects });
        expect(problems.some((p) => p.includes(`#${missing}`) && p.includes("not in state.objects"))).toBe(true);
    });

    test("reports an object whose own zone disagrees with the list holding it", () => {
        const game = newDemoGame();
        const id: ObjectId = game.players[ALICE]!.hand[0]!;
        const obj = game.objects[id]!;
        const problems = findProblems({ ...game, objects: { ...game.objects, [id]: { ...obj, zone: "graveyard" } } });

        expect(problems.some((p) => p.includes('is in Alice\'s hand but its zone says "graveyard"'))).toBe(true);
        expect(problems.some((p) => p.includes("no graveyard lists it"))).toBe(true);
    });
});
