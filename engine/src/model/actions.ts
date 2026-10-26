import type { ObjectId, PlayerId } from "./ids";
import type { Target } from "./state";

/** Everything a player can ask the engine to do. The engine validates each one against the rules. */
export type Action =
    | Readonly<{ type: "passPriority"; player: PlayerId }>
    | Readonly<{ type: "playLand"; player: PlayerId; card: ObjectId }>
    | Readonly<{
          type: "castSpell";
          player: PlayerId;
          card: ObjectId;
          targets: Target[];
      }>
    | Readonly<{
          type: "activateAbility";
          player: PlayerId;
          source: ObjectId;
          abilityIndex: number;
      }>;
