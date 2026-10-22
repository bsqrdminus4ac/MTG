import type { CardDefinition, ContinuousEffect, Effect } from "./cards";
import type { CastingInProgress } from "./casting";
import type { Decision } from "./decisions";
import type { CardDefId, ObjectId, PlayerId, StackId, Timestamp } from "./ids";
import type { ManaPool } from "./mana";

/**
 * Ordering convention: for library, graveyard and stack, the LAST element is the top.
 * Hand and battlefield order carry no rules meaning.
 */
export type Zone = "library" | "hand" | "battlefield" | "graveyard" | "stack" | "exile";

/** Main phases are modeled as steps here to keep the turn structure a flat list. */
export const STEPS = [
  "untap", "upkeep", "draw", "precombatMain",
  "beginningOfCombat", "declareAttackers", "declareBlockers", "combatDamage", "endOfCombat",
  "postcombatMain", "end", "cleanup",
] as const;
export type Step = (typeof STEPS)[number];

export type Phase = "beginning" | "precombatMain" | "combat" | "postcombatMain" | "ending";

export const PHASE_OF: Readonly<Record<Step, Phase>> = {
  untap: "beginning", upkeep: "beginning", draw: "beginning",
  precombatMain: "precombatMain",
  beginningOfCombat: "combat", declareAttackers: "combat", declareBlockers: "combat",
  combatDamage: "combat", endOfCombat: "combat",
  postcombatMain: "postcombatMain",
  end: "ending", cleanup: "ending",
};

/** Players normally don't get priority during untap or cleanup (CR 502.4, 514.3). */
export const stepGrantsPriority = (step: Step): boolean => step !== "untap" && step !== "cleanup";

/** A card (or token) in some zone. Everything mutable about it lives here, not on the definition. */
export interface GameObject {
    readonly id: ObjectId;
    readonly definitionId: CardDefId;
    readonly owner: PlayerId;
    readonly controller: PlayerId;
    readonly zone: Zone;
    readonly timestamp: Timestamp;
    readonly tapped: boolean;
    readonly damage: number;
    readonly counters: Readonly<Record<string, number>>;
    readonly turnEnteredZone?: number;
}

export interface PlayerState {
    readonly id: PlayerId;
    readonly life: number;
    readonly manaPool: ManaPool;
    readonly library: readonly ObjectId[];
    readonly hand: readonly ObjectId[];
    readonly graveyard: readonly ObjectId[];
    readonly landsPlayedThisTurn: number;
    readonly counters: Readonly<Record<string, number>>;

    /** Set when drawing from an empty library; a state-based action checks it (CR 704.5b). */
    readonly drewFromEmptyLibrary: boolean;
    readonly hasLostTheGame?: boolean;
}

export type Target =
  | Readonly<{ kind: "object"; id: ObjectId }>
  | Readonly<{ kind: "player"; id: PlayerId }>
  | Readonly<{ kind: "stackEntry"; id: StackId}>;

interface StackEntryBase {
  readonly id: StackId;
  readonly controller: PlayerId;
  /** For a spell, this is the card object itself (whose zone is "stack"). */
  readonly source: ObjectId;
  readonly targets: readonly Target[];
}
export interface SpellOnStack extends StackEntryBase {
  readonly kind: "spell";
}
export interface AbilityOnStack extends StackEntryBase {
  readonly kind: "ability";
  readonly effects: readonly Effect[];
}
export type StackEntry = SpellOnStack | AbilityOnStack;

export interface TurnState {
  readonly number: number;
  readonly activePlayer: PlayerId;
  readonly step: Step;
}

/** Who may act, and how many players in a row have passed since the last stack change (CR 117.4). */
export interface PriorityState {
  readonly holder: PlayerId;
  readonly consecutivePasses: number;
}

export interface GameState {
  readonly definitions: Readonly<Record<CardDefId, CardDefinition>>;
  readonly objects: Readonly<Record<ObjectId, GameObject>>;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly turnOrder: readonly PlayerId[];

  // Shared zones. Per-player zones (library, hand, graveyard) live on PlayerState.
  readonly battlefield: readonly ObjectId[];
  readonly exile: readonly ObjectId[];
  readonly stack: readonly StackEntry[];

  readonly continuousEffects: readonly ContinuousEffect[];
  readonly turn: TurnState;
  readonly priority: PriorityState | null;
  /** The question the engine is waiting on, if any. See decisions.ts. */
  readonly pending: Decision | null;

  /** Single counter used to issue ObjectIds, StackIds and Timestamps, so everything is deterministic. */
  readonly nextId: number;
  readonly winner: PlayerId | null;

  casting: CastingInProgress | null;
}