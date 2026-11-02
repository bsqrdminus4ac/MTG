import type { CardDefinition } from "@mtg/engine";
import { tapForMana } from "../builders/abilities";
import { land } from "../builders/defineCard";

export const forest = land({
    name: "Forest",
    subtypes: ["Forest"],
    abilities: [tapForMana("G")],
    isBasic: true,
});

export const mountain = land({
    name: "Mountain",
    subtypes: ["mountain"],
    abilities: [tapForMana("R")],
    isBasic: true,
});

export const grove = land({
    name: "Grove of the Burnwillows",
    abilities: [
        tapForMana("C"),
        {
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
                    bindAs: "chosenManaType",
                    prompt: "Add {R} or {G}. Each opponent gains 1 life.",
                    description: "{T}: Add {R} or {G}. Each opponent gains 1 life.",
                },
                { kind: "addMana", mana: { kind: "bound", name: "chosenManaType" }, amount: 1 },
                { kind: "forEach", over: { kind: "player", who: "eachOpponent" }, as: "p", body: [{ kind: "gainLife", who: { kind: "bound", name: "p" }, amount: 1 }] },
            ],
        },
    ],
});

export const LANDS: readonly CardDefinition[] = [forest, mountain, grove];