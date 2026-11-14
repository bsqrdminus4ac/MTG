import type { CardDefinition } from "@mtg/engine";
import { thisEntersTheBattlefield, triggered, whenThisDies } from "../builders/abilities";
import { creature, noncreatureArtifact } from "../builders/defineCard";

export const visionarySprite: CardDefinition = creature({
    name: "Visionary Sprite",
    cost: { generic: 0, pips: ["U"] },
    power: 1,
    toughness: 1,
    subtypes: ["Faerie"],
    abilities: [
        { kind: "keyword", keyword: "flying" },
        triggered({
            trigger: thisEntersTheBattlefield(),
            effects: [{ kind: "draw", count: 1, who: { kind: "player", who: "controller" } }],
            text: "When <this> enters, draw a card.",
        }),
    ],
});

export const reclamation: CardDefinition = noncreatureArtifact({
    name: "Moldervine Reclamation",
    cost: { generic: 0, pips: ["G", "B"] },
    abilities: [
        triggered({
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
            effects: [
                { kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1 },
                { kind: "draw", count: 1, who: { kind: "player", who: "controller" } },
            ],
            text: "Whenever a creature you control dies, you gain 1 life and draw a card.",
        }),
    ],
});

export const cask: CardDefinition = creature({
    name: "Unstable Cask",
    cost: { generic: 1, pips: [] },
    power: 0,
    toughness: 1,
    abilities: [
        triggered({
            trigger: whenThisDies(),
            effects: [
                {
                    kind: "damage",
                    amount: 1,
                    to: { kind: "target", spec: 0 },
                },
                { kind: "damage", amount: 2, to: { kind: "target", spec: 1 } },
            ],
            targets: [
                {
                    minCount: 0,
                    maxCount: 1,
                    filter: {
                        kind: "object",
                        filter: {
                            kind: "all",
                            of: [
                                { kind: "hasType", type: "Creature" },
                                { kind: "inZone", zone: "battlefield" },
                            ],
                        },
                    },
                    targetName: "creatures",
                },
                { minCount: 0, maxCount: 1, filter: { kind: "player", filter: { kind: "anyPlayer" } }, targetName: "players" },
            ],
            text: "When <this> dies, it deals 1 damage to up to one target creature and 2 damage to up to one target player.",
        }),
    ],
});

export const TRIGGER_TEST_CARDS: readonly CardDefinition[] = [visionarySprite, reclamation, cask];
