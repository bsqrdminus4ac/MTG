import { anyTarget, type CardDefinition } from "@mtg/engine";
import { drawCards, tapForMana } from "../builders/abilities";
import { creature, land, noncreatureArtifact } from "../builders/defineCard";

export const pyroAdept = creature({
    name: "Pyro Adept",
    cost: { generic: 0, pips: ["R"] },
    power: 0,
    toughness: 1,
    subtypes: ["Wizard"],
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { tap: true },
            targets: [{ filter: anyTarget(), minCount: 1, maxCount: 1 }],
            timingRestriction: "instantSpeed",
            effects: [
                {
                    kind: "damage",
                    amount: 1,
                    to: { kind: "target", spec: 0 },
                },
            ],
            text: "{T}: <this> deals 1 damage to any target.",
        },
    ],
});

export const clockworkScribe = noncreatureArtifact({
    name: "Clockwork Scribe",
    cost: { generic: 1, pips: [] },
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { tap: true, mana: { generic: 1, pips: [] } },
            timingRestriction: "instantSpeed",
            targets: [],
            effects: [drawCards(1)],
            text: "1, {T}: Draw a card.",
        },
    ],
});

export const arcaneElf = creature({
    name: "Arcane Elf",
    cost: { generic: 0, pips: ["G"] },
    power: 1,
    toughness: 1,
    subtypes: ["Elf"],
    abilities: [
        tapForMana("G"),
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { mana: { generic: 1, pips: ["G"] }, tap: true },
            targets: [],
            timingRestriction: "instantSpeed",
            effects: [{ kind: "gainLife", amount: 2, who: { kind: "player", who: "controller" } }],
            text: "1G, {T}: You gain 2 life.",
        },
    ],
});

export const scrapIdol = noncreatureArtifact({
    name: "Scrap Idol",
    cost: { generic: 1, pips: [] },
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { sacrificeSelf: true },
            targets: [],
            timingRestriction: "instantSpeed",
            effects: [{ kind: "gainLife", amount: 3, who: { kind: "player", who: "controller" } }],
            text: "Sacrifice <this>: You gain 3 life.",
        },
    ],
});

export const scrapShooter = creature({
    name: "Scrap Shooter",
    cost: { generic: 2, pips: [] },
    power: 2,
    toughness: 2,
    additionalTypes: ["Artifact"],
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { sacrificeSelf: true },
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
            timingRestriction: "instantSpeed",
            effects: [{ kind: "damage", amount: 2, to: { kind: "target", spec: 0 } }],
            text: "Sacrifice <this>: <this> deals 2 damage to any target.",
        },
    ],
});

export const treasureChest = noncreatureArtifact({
    name: "Treasure Chest",
    cost: { generic: 1, pips: [] },
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { tap: true, sacrificeSelf: true },
            isManaAbility: true,
            targets: [],
            timingRestriction: "instantSpeed",
            effects: [{ kind: "addMana", mana: { kind: "mana", type: "R" }, amount: 1 }],
            text: "{T}, sacrifice <this>: Add R.",
        },
    ],
});

export const painfulPeak = land({
    name: "Painful Peak",
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { tap: true },
            targets: [],
            timingRestriction: "instantSpeed",
            isManaAbility: true,
            effects: [
                { kind: "addMana", mana: { kind: "mana", type: "R" }, amount: 1 },
                { kind: "loseLife", amount: 1, who: { kind: "player", who: "controller" } },
            ],
            text: "{T}: Add R. You lose 1 life.",
        },
    ],
});

export const dustyFilter = land({
    name: "Dusty Filter",
    abilities: [
        {
            kind: "activated",
            activateableZones: ["battlefield"],
            cost: { tap: true, mana: { generic: 1, pips: [] } },
            targets: [],
            timingRestriction: "instantSpeed",
            isManaAbility: true,
            effects: [{ kind: "addMana", mana: { kind: "mana", type: "G" }, amount: 2 }],
            text: "1, {T}: Add GG.",
        },
    ],
});

export const ACTIVATION_TEST_CARDS: readonly CardDefinition[] = [pyroAdept, clockworkScribe, arcaneElf, scrapIdol, scrapShooter, treasureChest, painfulPeak, dustyFilter];
