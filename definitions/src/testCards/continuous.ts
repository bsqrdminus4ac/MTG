import type { CardDefinition } from "@mtg/engine";
import { anthem, creaturesYouControl, drawCards, grantKeyword, tapForMana, triggered, whenThisDies } from "../builders/abilities";
import { creature, enchantment, instant } from "../builders/defineCard";

export const gloriousAnthem = enchantment({
    name: "Glorious Anthem",
    cost: "1W",
    abilities: [anthem(creaturesYouControl(), 1, 1, "Creatures you control get +1/+1.")],
});

export const wingSplicer = creature({
    name: "Wing Splicer",
    cost: "U",
    power: 1,
    toughness: 1,
    subtypes: ["Human", "Artificer"],
    abilities: [grantKeyword(creaturesYouControl(true), ["flying"], "Other creatures you control have Flying.")],
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
                    targetName: "creature",
                },
            ],
            effects: [
                {
                    kind: "applyContinuousEffect",
                    template: {
                        affects: { kind: "target", spec: 0 },
                        duration: "untilEndOfTurn",
                        modifications: [{ kind: "modifyPT", power: 3, toughness: 3 }],
                    },
                },
            ],
            text: "Target creature gets +3/+3 until end of turn.",
        },
    ],
});

export const llanowar = creature({
    name: "Llanowar Tribe",
    cost: "G",
    power: 1,
    toughness: 1,
    subtypes: ["Elf", "Druid"],
    abilities: [
        {
            kind: "static",
            activeZones: ["battlefield"],
            effect: {
                affects: { kind: "matching", filter: creaturesYouControl() },
                modifications: [{ kind: "addAbilities", abilities: [tapForMana("G")] }],
            },
            text: 'Creatures you control have "{T}: Add G".',
        },
    ],
});

export const infusion = instant({
    name: "Hela's Infusion",
    cost: "B",
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
            effects: [
                {
                    kind: "applyContinuousEffect",
                    template: {
                        affects: { kind: "target", spec: 0 },
                        duration: "untilEndOfTurn",
                        modifications: [{ kind: "addAbilities", abilities: [triggered({ trigger: whenThisDies(), effects: [drawCards(1)], text: "When this creature dies, draw a card." })] }],
                    },
                },
            ],
            text: 'Until end of turn, target creature gains "When this creature dies, draw a card."',
        },
    ],
});

export const CONTINUOUS_TEST_CARDS: CardDefinition[] = [gloriousAnthem, wingSplicer, giantGrowth, llanowar, infusion];
