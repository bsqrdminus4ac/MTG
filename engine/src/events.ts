import { playerId, type ObjectId, type PlayerId, type StackId } from "./ids";
import type { AttackableTarget, Step, Target, Zone } from "./state";

/**
 * Facts about what just happened. The engine returns these alongside the new state.
 * They drive the UI log, replays, and (later) triggered abilities.
 */
export type GameEvent =
    | Readonly<{ type: "turnStarted"; turn: number; activePlayer: PlayerId }>
    | Readonly<{ type: "stepStarted"; step: Step }>
    | Readonly<{ type: "priorityPassed"; player: PlayerId }>
    | Readonly<{
          type: "cardMoved";
          from: Zone;
          to: Zone;
          oldId: ObjectId;
          newId: ObjectId;
          owner: PlayerId;
      }>
    | Readonly<{ type: "cardDrawn"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "landPlayed"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellCastSuccess"; player: PlayerId; card: ObjectId; cardName: string; targets: readonly Target[] }>
    | Readonly<{ type: "spellCastStart"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellTargetsSelected"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellManaPaid"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellCastCancelled"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "stackEntryResolved"; id: StackId; spellName: string }>
    | Readonly<{ type: "damageDealt"; source: ObjectId; sourceName: string; target: Target; targetName: string; amount: number; isCombatDamage: boolean }>
    | Readonly<{ type: "lifeChanged"; player: PlayerId; delta: number }>
    | Readonly<{ type: "gameWon"; winner: PlayerId }>
    | Readonly<{ type: "permanentTapped"; object: ObjectId; cardName: string }>
    | Readonly<{ type: "permanentUntapped"; object: ObjectId; cardName: string }>
    | Readonly<{ type: "abilityActivated"; player: PlayerId; abilitySource: ObjectId; cardName: string; stackEntryId?: StackId; targets?: Target[] }>
    | Readonly<{ type: "attackDeclared"; player: PlayerId; object: ObjectId; cardName: string; target: AttackableTarget; targetName: string }>
    | Readonly<{ type: "lostTheGame"; player: PlayerId; cause: string }>
    | Readonly<{ type: "wonTheGame"; player: PlayerId }>;
