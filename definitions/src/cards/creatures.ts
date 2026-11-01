import type { CardDefinition } from "@mtg/engine";
import { creature } from "../builders/defineCard";



export const bear: CardDefinition = creature({
    name: "Grizzly Bears",
    cost: { generic: 1, pips: ["G"] },
    subtypes: ["Bear"],
    power: 2,
    toughness: 2,
});


export const drake: CardDefinition = creature({
    name: "Wind Drake",
    cost: { generic: 2, pips: ["U"] },
    subtypes: ["Drake"],
    power: 2,
    toughness: 2,
    abilities: [{ kind: "keyword", keyword: "flying" }],
});

export const CREATURES: readonly CardDefinition[] = [bear, drake];