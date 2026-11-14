import type { CardDefinition } from "@mtg/engine";
import { tapForMana } from "../builders/abilities";
import { land } from "../builders/defineCard";

export const plains = land({
    name: "Plains",
    subtypes: ["plains"],
    abilities: [tapForMana("W")],
    isBasic: true,
});

export const island = land({
    name: "Island",
    subtypes: ["island"],
    abilities: [tapForMana("U")],
    isBasic: true,
});

export const swamp = land({
    name: "Swamp",
    subtypes: ["swamp"],
    abilities: [tapForMana("B")],
    isBasic: true,
});

export const mountain = land({
    name: "Mountain",
    subtypes: ["mountain"],
    abilities: [tapForMana("R")],
    isBasic: true,
});

export const forest = land({
    name: "Forest",
    subtypes: ["Forest"],
    abilities: [tapForMana("G")],
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
                },
                { kind: "addMana", mana: { kind: "bound", name: "chosenManaType" }, amount: 1 },
                { kind: "forEach", over: { kind: "player", who: "eachOpponent" }, as: "p", body: [{ kind: "gainLife", who: { kind: "bound", name: "p" }, amount: 1 }] },
            ],
            text: "{T}: Add {R} or {G}. Each opponent gains 1 life.",
        },
    ],
});

export const confluence = land({
    name: "Mana Confluence",
    abilities: [
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
                    from: { kind: "manaType", allowed: ["W", "U", "B", "R", "G"] },
                    min: 1,
                    max: 1,
                    bindAs: "chosenManaType",
                    prompt: "Add one mana of any color. You lose 1 life.",
                },
                { kind: "addMana", mana: { kind: "bound", name: "chosenManaType" }, amount: 1 },
                { kind: "loseLife", who: { kind: "player", who: "controller" }, amount: 1 },
            ],
            text: "{T}: Add one mana of any color. You lose 1 life.",
        },
    ],
});

export const LANDS: readonly CardDefinition[] = [plains, island, swamp, mountain, forest, grove, confluence];