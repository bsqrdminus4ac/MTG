import type { CardDefinition } from "@mtg/engine";
import { discardThenGainLife, eachPlayerDiscards } from "../builders/abilities";
import { sorcery } from "../builders/defineCard";

export const discardLife: CardDefinition = sorcery({
    name: "Mind Twist",
    cost: { generic: 0, pips: ["R"] },
    abilities: [discardThenGainLife()],
});

export const skeins: CardDefinition = sorcery({
    name: "Delirium Skeins",
    cost: { generic: 0, pips: ["G"] },
    abilities: [eachPlayerDiscards(3)],
});

export const DECISION_TEST_CARDS: readonly CardDefinition[] = [discardLife, skeins];