import type { CardDefinition } from "@mtg/engine";
import { anthem, grantKeyword } from "../builders/abilities";
import { creature, enchantment, instant } from "../builders/defineCard";

export const gloriousAnthem = enchantment({
    name: "Glorious Anthem",
    cost: "1W",
    abilities: [
        anthem(
            {
                kind: "all",
                of: [
                    { kind: "inZone", zone: "battlefield" },
                    { kind: "hasType", type: "Creature" },
                    { kind: "controlledBy", who: "you" },
                ],
            },
            1,
            1,
        ),
    ],
});

export const wingSplicer = creature({
    name: "Wing Splicer",
    cost: "U",
    power: 1,
    toughness: 1,
    subtypes: ["Human", "Artificer"],
    abilities: [
        grantKeyword(
            {
                kind: "all",
                of: [
                    { kind: "inZone", zone: "battlefield" },
                    { kind: "hasType", type: "Creature" },
                    { kind: "controlledBy", who: "you" },
                    { kind: "not", of: { kind: "isSource" } },
                ],
            },
            ["flying"],
        ),
    ],
});

export const giantGrowth = instant({
    name: "Giant Growth",
    cost: "G",
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
                    description: "creature",
                },
            ],
            effects: [
                {
                    kind: "applyContinuousEffect",
                    template: {
                        affects: { kind: "target", spec: 0 },
                        duration: "untilEndOfTurn",
                        modifications: [{ kind: "modifyPT", power: 3, toughness: 3 }],
                        description: "Target creature gets +3/+3 until end of turn.",
                    },
                },
            ],
        },
    ],
});

export const CONTINUOUS_TEST_CARDS: CardDefinition[] = [gloriousAnthem, wingSplicer, giantGrowth];
