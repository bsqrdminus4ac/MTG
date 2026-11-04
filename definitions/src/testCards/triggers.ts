import type { CardDefinition } from "@mtg/engine";
import { thisEntersTheBattlefield, triggered } from "../builders/abilities";
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
            effects: [{ kind: "draw", count: 1, who: { kind: "player", who: "controller" }, description: "When <this> enters, draw a card." }],
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
                { kind: "gainLife", who: { kind: "player", who: "controller" }, amount: 1, description: "Whenever a creature you control dies, you gain 1 life and draw a card." },
                { kind: "draw", count: 1, who: { kind: "player", who: "controller" } },
            ],
        }),
    ],
});

export const TRIGGER_TEST_CARDS: readonly CardDefinition[] = [visionarySprite, reclamation];
