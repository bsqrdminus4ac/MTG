import type { Ability } from "./abilities";
import type { EffectTarget } from "./effects";
import type { EffectId, ObjectId, PlayerId, Timestamp } from "./ids";
import type { Color } from "./mana";
import type { ObjectPredicate } from "./predicates";
import type { CardType, Keyword, Zone } from "./vocabulary";

export type Layer =
    | "copy" // Layer 1: Copy effect and face down cards
    | "control" // Layer 2: Control-changing effects
    | "text" // Layer 3: Text-changing effects
    | "type" // Layer 4: Type, supertype, and subtype changes
    | "color" // Layer 5: Color changes
    | "ability" // Layer 6: Ability granting and removal, plus rules like "can't block"
    | "characteristicDefining" // Layer 7a: */* abilities and others defined by the card
    | "setPT" // Layer 7b: Effects that set power/toughness to a specific value
    | "modifyPT" // Layer 7c: Effects that modify power/toughness, including +1/+1 counters
    | "switchPT"; // Layer 7d: Effects that swap power/toughness

/** Application order. Within a layer, effects apply in timestamp order. */
export const LAYER_ORDER: readonly Layer[] = ["copy", "control", "text", "type", "color", "ability", "characteristicDefining", "setPT", "modifyPT", "switchPT"];

export type Modification =
    // Layer 1

    // Layer 2

    // Layer 3

    // Layer 4
    | Readonly<{ kind: "setTypes"; types: readonly CardType[] }>
    | Readonly<{ kind: "addTypes"; types: readonly CardType[] }>
    | Readonly<{ kind: "addSubtypes"; types: string[] }>
    // Layer 5
    | Readonly<{ kind: "setColors"; colors: readonly Color[] }>
    | Readonly<{ kind: "addColors"; colors: readonly Color[] }>
    // Layer 6
    | Readonly<{ kind: "addAbilities"; abilities: readonly Ability[] }>
    | Readonly<{ kind: "addKeywords"; keywords: readonly Keyword[] }>
    | Readonly<{ kind: "removeKeywords"; keywords: readonly Keyword[] }>
    // Layer 7a

    // Layer 7b
    | Readonly<{ kind: "setPT"; power: number; toughness: number }>
    // Layer 7c
    | Readonly<{ kind: "modifyPT"; power: number; toughness: number }>
    // Layer 7d
    | Readonly<{ kind: "switchPT" }>;

export const LAYER_OF: Record<Modification["kind"], Layer> = {
    setTypes: "type",
    addTypes: "type",
    addSubtypes: "type",
    setColors: "color",
    addColors: "color",
    addAbilities: "ability",
    addKeywords: "ability",
    removeKeywords: "ability",
    setPT: "setPT",
    modifyPT: "modifyPT",
    switchPT: "switchPT",
};

export type Duration = "untilEndOfTurn" | "whileSourceOnBattlefield" | "permanent";

export type ObjectMatch = Readonly<{ kind: "matching"; filter: ObjectPredicate; zones?: readonly Zone[] }>;
export type AffectedSet = Readonly<{ kind: "self" }> | ObjectMatch;

/**  A static effect tied to the static ability of an object */
export interface StaticEffect {
    readonly affects: AffectedSet;
    readonly modifications: Modification[];
    readonly description?: string;
}
/** The template an applyContinuousEffect effect carries. It is definition data only and never lives in state or on an object as a rule. Resolution turns it into a live ContinuousEffect in state.continuousEffects */
export interface AppliedEffect {
    readonly affects: EffectTarget | ObjectMatch;
    readonly modifications: Modification[];
    readonly duration: Duration;
    readonly description?: string;
}

/** A live effect in the game, tied to its source and a timestamp. */
export interface ContinuousEffect {
    readonly id: EffectId;
    readonly source: ObjectId;
    readonly controller: PlayerId;
    readonly timestamp: Timestamp;
    readonly affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | ObjectMatch;
    readonly modifications: Modification[];
    readonly duration: Duration;
    readonly sourceName?: string;
    readonly description?: string;
}
