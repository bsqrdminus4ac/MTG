import type { CardDefinition } from "@mtg/engine";
import { affectsAllPlayers, affectsYou, allCreatures, costsLess, costsMore } from "../builders/abilities";
import { instant, noncreatureArtifact } from "../builders/defineCard";

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
            effects: [{
                kind: "applyContinuousEffect", 
                template: {
                    duration: "untilEndOfTurn",
                    affects: affectsYou,
                    modifications: [costsLess("spell", "1")]
                }
            }],
            text: "Until end of turn, spells you cast cost {1} less to cast."
        }
    ]
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

export const COSTS_TEST_CARDS: readonly CardDefinition[] = [taxSphere, medallion, manaBargain, tollBooth];
