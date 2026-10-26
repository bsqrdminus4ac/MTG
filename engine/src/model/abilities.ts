import type { ContinuousEffectTemplate } from "./continuous";
import type { Effect, TargetSpec } from "./effects";
import type { GameEvent } from "./events";
import type { ObjectId } from "./ids";
import type { ManaCost } from "./mana";
import type { Zone, Keyword } from "./vocabulary";

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

export interface ActivatableAbilityInfo {
    source: ObjectId;
    ability: AbilityOfKind<"activated">;
    abilityIndex: number;
}