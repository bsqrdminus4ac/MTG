import type { CardDefinition } from "@mtg/engine";
import { creature } from "../builders/defineCard";

export const shySprite = creature({
    name: "Shy Sprite",
    cost: { generic: 0, pips: ["G"] },
    power: 1,
    toughness: 1,
    abilities: [{ kind: "keyword", keyword: "hexproof" }],
});

export const TARGETING_TEST_CARDS: CardDefinition[] = [shySprite];