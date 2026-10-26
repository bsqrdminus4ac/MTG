import { assertNever } from "../core/util";
import type { ObjectId, Timestamp } from "./ids";
import type { Color } from "./mana";
import type { CardType, Keyword } from "./vocabulary";

export type Layer = "copy" | "control" | "text" | "type" | "color" | "ability" | "characteristicDefining" | "setPT" | "modifyPT" | "switchPT";

/** Application order. Within a layer, effects apply in timestamp order. */
export const LAYER_ORDER: readonly Layer[] = ["copy", "control", "text", "type", "color", "ability", "characteristicDefining", "setPT", "modifyPT", "switchPT"];

export type Modification =
    | Readonly<{ kind: "modifyPT"; power: number; toughness: number }>
    | Readonly<{ kind: "setPT"; power: number; toughness: number }>
    | Readonly<{ kind: "addKeyword"; keyword: Keyword }>
    | Readonly<{ kind: "addType"; type: CardType }>
    | Readonly<{ kind: "setColors"; colors: readonly Color[] }>;

export function layerOf(m: Modification): Layer {
    switch (m.kind) {
        case "modifyPT":
            return "modifyPT";
        case "setPT":
            return "setPT";
        case "addKeyword":
            return "ability";
        case "addType":
            return "type";
        case "setColors":
            return "color";
        default:
            return assertNever(m);
    }
}

export type Duration = "untilEndOfTurn" | "whileSourceOnBattlefield" | "permanent";

/** Written on a card, before it's tied to a specific source object. */
export interface ContinuousEffectTemplate {
    readonly affects: Readonly<{ kind: "self" }> | Readonly<{ kind: "allCreatures" }>;
    readonly modification: Modification;
    readonly duration: Duration;
}

/** A live effect in the game, tied to its source and a timestamp. */
export interface ContinuousEffect {
    readonly source: ObjectId;
    readonly timestamp: Timestamp;
    readonly affects: Readonly<{ kind: "object"; id: ObjectId }> | Readonly<{ kind: "allCreatures" }>;
    readonly modification: Modification;
    readonly duration: Duration;
}