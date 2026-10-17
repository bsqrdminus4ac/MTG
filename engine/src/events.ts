import type { ObjectId, PlayerId, StackId } from "./ids";
import type { Step, Target, Zone } from "./state";

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
  | Readonly<{ type: "cardDrawn"; player: PlayerId; card: ObjectId }>
  | Readonly<{ type: "landPlayed"; player: PlayerId; card: ObjectId }>
  | Readonly<{ type: "spellCast"; player: PlayerId; card: ObjectId }>
  | Readonly<{ type: "stackEntryResolved"; id: StackId }>
  | Readonly<{ type: "damageDealt"; source: ObjectId; target: Target; amount: number }>
  | Readonly<{ type: "lifeChanged"; player: PlayerId; delta: number }>
  | Readonly<{ type: "gameWon"; winner: PlayerId }>
  | Readonly<{ type: "permanentTapped"; object: ObjectId }>
  | Readonly<{ type: "permanentUntapped"; object: ObjectId }>
  | Readonly<{type:  "abilityActivated"; player: PlayerId; abilitySource: ObjectId; stackEntryId?: StackId; targets?: Target[]}>
  ;
