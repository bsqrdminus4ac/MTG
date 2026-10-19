import type { CardDefId, ObjectId, Timestamp } from "./ids";
import type { Color, ManaCost, ManaType } from "./mana";
import type { GameEvent } from "./events";
import { assertNever } from "./util";
import type { Zone } from "./state";

export type CardType =
  | "Artifact" | "Battle" | "Creature" | "Enchantment"
  | "Instant" | "Land" | "Planeswalker" | "Sorcery";
export type PermanentType = Exclude<CardType, "Instant" | "Sorcery">;
export type Supertype = "Basic" | "Legendary" | "Snow";
export type Keyword =
  | "flying" | "firstStrike" | "doubleStrike" | "deathtouch" | "haste" | "lifelink"
  | "reach" | "trample" | "vigilance" | "menace" | "defender" | "hexproof" | "indestructible";

// ---------------------------------------------------------------------------
// Effects: what an ability or spell does. Pure data, interpreted by the engine.
// ---------------------------------------------------------------------------

/** Relative to the controller of the spell/ability. */
export type PlayerRef = "controller" | "opponent" | "eachPlayer";

export type TargetKinds =
 | Readonly<{kind: "Permanent", allowedTypes: PermanentType[] | "any", zone: "battlefield"}>
 | Readonly<{kind: "Player", allowedTypes: "opponent" | "any", zone: "battlefield"}>
 | Readonly<{kind: "GraveyardCard", zone: "graveyard"}>
 | Readonly<{kind: "StackAbility", zone: "stack"}>
 | Readonly<{kind: "AnyTarget", zone: "battlefield"}> // Shorthand for player / creature / planeswalker / battle
 ;

export type TargetSpec = TargetKinds & {minCount: number; maxCount: number};

export type EffectTarget =
  | Readonly<{ kind: "target"; index: number }> // index into the chosen targets
  | Readonly<{ kind: "self" }>
  | Readonly<{ kind: "player"; who: PlayerRef }>;

export type Effect =
  | Readonly<{ kind: "draw"; who: PlayerRef; count: number }>
  | Readonly<{ kind: "damage"; to: EffectTarget; amount: number }>
  | Readonly<{ kind: "gainLife"; who: PlayerRef; amount: number }>
  | Readonly<{ kind: "loseLife"; who: PlayerRef; amount: number }>
  | Readonly<{ kind: "destroy"; target: EffectTarget }>
  | Readonly<{ kind: "addMana"; mana: ManaType; amount: number }>
  | Readonly<{ kind: "applyContinuousEffect"; template: ContinuousEffectTemplate }>;

// ---------------------------------------------------------------------------
// Continuous effects and layers (CR 613)
// ---------------------------------------------------------------------------

export type Layer =
  | "copy" | "control" | "text" | "type" | "color" | "ability"
  | "characteristicDefining" | "setPT" | "modifyPT" | "switchPT";

/** Application order. Within a layer, effects apply in timestamp order. */
export const LAYER_ORDER: readonly Layer[] = [
  "copy", "control", "text", "type", "color", "ability",
  "characteristicDefining", "setPT", "modifyPT", "switchPT",
];

export type Modification =
  | Readonly<{ kind: "modifyPT"; power: number; toughness: number }>
  | Readonly<{ kind: "setPT"; power: number; toughness: number }>
  | Readonly<{ kind: "addKeyword"; keyword: Keyword }>
  | Readonly<{ kind: "addType"; type: CardType }>
  | Readonly<{ kind: "setColors"; colors: readonly Color[] }>;

export function layerOf(m: Modification): Layer {
  switch (m.kind) {
    case "modifyPT": return "modifyPT";
    case "setPT": return "setPT";
    case "addKeyword": return "ability";
    case "addType": return "type";
    case "setColors": return "color";
    default: return assertNever(m);
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

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

export type Cost = Readonly<{
  mana: ManaCost | null;
  tap: boolean;
  sacrificeSelf: boolean;
}>;

export type TriggerCondition = Readonly<{
  event: GameEvent["type"];
  scope: "self" | "any";
}>;

export type Ability =
  | Readonly<{ kind: "keyword"; keyword: Keyword }>
  /** The text of an instant or sorcery. */
  | Readonly<{ kind: "spell"; targets: TargetSpec[]; effects: readonly Effect[] }>
  | Readonly<{
      kind: "activated";
      cost: Cost;
      isManaAbility: boolean; // mana abilities don't use the stack (CR 605)
      targets: TargetSpec[];
      effects: readonly Effect[];
      activateableZones: readonly Zone[];
      timingRestriction: "sorcerySpeed" | "instantSpeed";
      description?: string; // for UI, not used by the engine
    }>
  | Readonly<{
      kind: "triggered";
      trigger: TriggerCondition;
      targets: TargetSpec[];
      effects: readonly Effect[];
      triggerableZones: readonly Zone[];
    }>
  | Readonly<{ kind: "static"; effect: ContinuousEffectTemplate }>;

export type AbilityOfKind<K extends Ability["kind"]> = Extract<Ability, { kind: K }>;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** The copiable values of an object (CR 109.3). Derived per-object by getCharacteristics. */
export interface Characteristics {
  readonly name: string;
  readonly manaCost: ManaCost | null;
  readonly colors: readonly Color[];
  readonly supertypes: readonly Supertype[];
  readonly types: readonly CardType[];
  readonly subtypes: readonly string[];
  readonly power: number | null;
  readonly toughness: number | null;
  readonly abilities: readonly Ability[];
}

/** Static card data. Many game objects can share one definition. */
export interface CardDefinition extends Characteristics {
  readonly id: CardDefId;
}
