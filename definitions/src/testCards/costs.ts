import { anyTarget, YOU, type CardDefinition } from "@mtg/engine";
import { affectsAllPlayers, affectsYou, allCreatures, costsLess, costsMore, drawCards } from "../builders/abilities";
import { creature, instant, noncreatureArtifact } from "../builders/defineCard";

export const taxSphere = noncreatureArtifact({
    name: "Tax Sphere",
    cost: "1",
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: affectsAllPlayers,
                modifications: [costsMore("spell", "1", { kind: "not", of: { kind: "hasType", type: "Creature" } })],
            },
            text: "Noncreature spells cost {1} more to cast.",
        },
    ],
});

export const medallion = noncreatureArtifact({
    name: "Thrift Medallion",
    cost: "1",
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: affectsYou,
                modifications: [costsLess("spell", "1", { kind: "hasType", type: "Creature" })],
            },
            text: "Creature spells you cast cost {1} less to cast.",
        },
    ],
});

export const manaBargain = instant({
    name: "Mana Bargain",
    cost: "1W",
    abilities: [
        {
            kind: "spell",
            targets: [],
            effects: [
                {
                    kind: "applyContinuousEffect",
                    template: {
                        duration: "untilEndOfTurn",
                        affects: affectsYou,
                        modifications: [costsLess("spell", "1")],
                    },
                },
            ],
            text: "Until end of turn, spells you cast cost {1} less to cast.",
        },
    ],
});

export const tollBooth = noncreatureArtifact({
    name: "Toll Booth",
    cost: "1",
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: affectsAllPlayers,
                modifications: [costsMore("activated", "1", allCreatures())],
            },
            text: "Activated abilities of creatures cost {1} more to activate.",
        },
    ],
});

export const bloodIdol = noncreatureArtifact({
    name: "Blood Idol",
    cost: "1",
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: [{ kind: "payLife", amount: 2 }],
            targets: [],
            effects: [drawCards(1)],
            timingRestriction: "instantSpeed",
            text: "Pay 2 life: Draw a card.",
        },
    ],
});

export const sacOutlet = creature({
    name: "Sacrifice Outlet",
    cost: "B",
    power: 1,
    toughness: 1,
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: [{ kind: "sacrifice", amount: 1, what: { kind: "hasType", type: "Creature" } }],
            effects: [{ kind: "gainLife", who: YOU, amount: 1 }],
            targets: [],
            timingRestriction: "instantSpeed",
            text: "Sacrifice a creature: You gain 1 life.",
        },
    ],
});

export const pitchBolt = instant({
    name: "Pitch Bolt",
    cost: "R",
    additionalCosts: [{ kind: "optional", bindAs: "kicker", cost: [{ kind: "discard", amount: 1 }], prompt: "Discard a card?" }],
    abilities: [
        {
            kind: "spell",
            targets: [{ filter: anyTarget(), minCount: 1, maxCount: 1 }],
            effects: [
                {
                    kind: "if",
                    condition: { kind: "flag", name: "kicker" },
                    then: [{ kind: "damage", amount: 4, to: { kind: "target", spec: 0 } }],
                    else: [{ kind: "damage", amount: 2, to: { kind: "target", spec: 0 } }],
                },
            ],
            text: "As an additional cost to cast this spell, you may discard a card. <this> deals 2 damage to any target. If the additional cost was paid, it deals 4 damage to that target instead.",
        },
    ],
});

export const COSTS_TEST_CARDS: readonly CardDefinition[] = [taxSphere, medallion, manaBargain, tollBooth, bloodIdol, sacOutlet, pitchBolt];
