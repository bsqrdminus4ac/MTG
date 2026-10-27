import type { CardDefinition } from "./cardDefinition";
import type { ContinuousEffect } from "./continuous";
import type { ChoiceValue, Decision } from "./decisions";
import type { Effect } from "./effects";
import type { GameEvent } from "./events";
import type { CardDefId, ObjectId, PlayerId, StackId, Timestamp } from "./ids";
import type { ManaCost, ManaPool } from "./mana";
import type { Step, Zone } from "./vocabulary";

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
    readonly combatInfo?: CombatInfo;
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

export type Target = Readonly<{ kind: "object"; id: ObjectId }> | Readonly<{ kind: "player"; id: PlayerId }> | Readonly<{ kind: "stackEntry"; id: StackId }>;
export type AttackableTarget = Exclude<Target, { kind: "stackEntry" }>;

interface StackEntryBase {
    readonly id: StackId;
    readonly controller: PlayerId;
    /** For a spell, this is the card object itself (whose zone is "stack"). */
    readonly source: ObjectId;
    readonly targets: readonly Target[];
}
export interface SpellOnStack extends StackEntryBase {
    readonly kind: "spell";
    readonly spellIndex?: number; // Placeholder for if a card contains more than one spell (MDFC, adventures, etc.)
}
export interface AbilityOnStack extends StackEntryBase {
    readonly kind: "ability";
    readonly definitionId: CardDefId;
    readonly abilityIndex: number;
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

export function nextPlayer(state: GameState, from: PlayerId): PlayerId {
    const i = state.turnOrder.indexOf(from);
    return state.turnOrder[(i + 1) % state.turnOrder.length] ?? from;
}

export const getRemainingPlayersInTurnOrder = (state: GameState): PlayerId[] => {
    let p: PlayerId = state.turn.activePlayer;
    const order = [p]; // Assumes active player hasn't lost the game
    do {
        p = nextPlayer(state, p);
        if (state.players[p] && !state.players[p]?.hasLostTheGame) order.push(p);
    } while (p !== state.turn.activePlayer);
    return order;
};

export interface CombatInProgress {
    rollback: GameState | null;
    attackers: Readonly<Record<ObjectId, CombatInfo>>;
    currentTargetDecision?: ObjectId | undefined;
    blocksChosen?: Readonly<Record<ObjectId, boolean>>;
}

export interface CombatInfo {
    id: ObjectId;
    attackableTargets?: AttackableTarget[] | undefined;
    attackTarget?: AttackableTarget;
    blockedBy?: readonly ObjectId[];
    blockOrder?: readonly number[];
}

export interface CastingInProgress {
    player: PlayerId;
    card: ObjectId; // still in hand until commit
    targets: readonly Target[];
    targetSpecsSelected: readonly boolean[];
    cost: ManaCost | null; // total cost, determined after targets
    rollback: GameState; // state before casting began
    events: readonly GameEvent[]; // buffered until commit
}

export interface ResolutionInProgress {
    entry: StackEntry;
    effects: readonly Effect[];
    pc: number;
    bindings: Bindings;
}

export type Binding = readonly ChoiceValue[] | boolean | number;
export type Bindings = Readonly<Record<string, Binding>>;

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

    readonly casting: CastingInProgress | null;
    readonly combat: CombatInProgress | null;
    readonly resolving: ResolutionInProgress | null;
}
