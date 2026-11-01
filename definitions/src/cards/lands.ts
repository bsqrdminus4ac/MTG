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


export const LANDS: readonly CardDefinition[] = [forest, mountain];