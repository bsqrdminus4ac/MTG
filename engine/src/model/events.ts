import { type ObjectId, type PlayerId, type StackId } from "./ids";
import type { ManaType } from "./mana";
import type { AttackableTarget, ObjectSnapshot, Target } from "./state";
import type { Step, Zone } from "./vocabulary";

type WinLossEvent = Readonly<{ type: "lostTheGame"; player: PlayerId; cause: string }> | Readonly<{ type: "wonTheGame"; player: PlayerId }>;

type StepEvent =
    | Readonly<{ type: "turnStarted"; turn: number; activePlayer: PlayerId }>
    | Readonly<{ type: "stepStarted"; step: Step; activePlayer: PlayerId }>
    | Readonly<{ type: "priorityPassed"; player: PlayerId; step: Step }>
    | Readonly<{
          type: "cardMoved";
          from: Zone;
          to: Zone;
          oldId: ObjectId;
          newId: ObjectId;
          owner: PlayerId;
          lki: ObjectSnapshot | undefined;
      }>;

type PlayerEvent =
    | Readonly<{ type: "cardDrawn"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "landPlayed"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "lifeChanged"; player: PlayerId; delta: number }>
    | Readonly<{ type: "manaAdded"; player: PlayerId; mana: ManaType; amount: number }>
    | Readonly<{ type: "cardDiscarded"; player: PlayerId; card: ObjectId; cardName: string; cause?: string }>;

type ObjectEvent =
    | Readonly<{ type: "damageDealt"; source: ObjectId; target: Target; sourceLki: ObjectSnapshot; targetLki?: ObjectSnapshot; targetName?: string; amount: number; isCombatDamage: boolean }>
    | Readonly<{ type: "permanentTapped"; object: ObjectId; cardName: string }>
    | Readonly<{ type: "permanentUntapped"; object: ObjectId; cardName: string }>
    | Readonly<{ type: "permanentDestroyed"; object: ObjectId; cardName: string; sourceName?: string }>
    | Readonly<{ type: "permanentSacrificed"; object: ObjectId; cardName: string; sourceName?: string }>;

type StackEvent =
    | Readonly<{ type: "spellCastSuccess"; player: PlayerId; card: ObjectId; spellLki: ObjectSnapshot; targets: readonly Target[] }>
    | Readonly<{ type: "spellCastStart"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellTargetsSelected"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellManaPaid"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "spellCastCancelled"; player: PlayerId; card: ObjectId; cardName: string }>
    | Readonly<{ type: "abilityActivateStart"; player: PlayerId; abilitySource: ObjectId; sourceName: string; description: string }>
    | Readonly<{ type: "abilityActivated"; player: PlayerId; abilitySourceLki: ObjectSnapshot; description: string; targets: readonly Target[] }>
    | Readonly<{ type: "abilityActivateCancelled"; player: PlayerId; abilitySource: ObjectId; sourceName: string; description: string }>
    | Readonly<{ type: "stackEntryResolved"; id: StackId; entryName: string }>
    | Readonly<{ type: "stackEntryFizzles"; id: StackId; entryName: string }>;

type CombatEvent =
    | Readonly<{ type: "attackDeclared"; player: PlayerId; attackerLki: ObjectSnapshot; target: AttackableTarget; targetLki?: ObjectSnapshot; targetName?: string }>
    | Readonly<{ type: "attacksCancelled"; player: PlayerId }>
    | Readonly<{ type: "blockDeclared"; player: PlayerId; blockerLki: ObjectSnapshot; attackerLki: ObjectSnapshot }>
    | Readonly<{ type: "blocksCancelled"; player: PlayerId }>;

/**
 * Facts about what just happened. The engine returns these alongside the new state.
 * They drive the UI log, replays, and (later) triggered abilities.
 */
export type GameEvent = StepEvent | PlayerEvent | ObjectEvent | StackEvent | CombatEvent | WinLossEvent;
