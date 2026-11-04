import type { ContinuousEffectTemplate } from "./continuous";
import type { CardEffect, Condition, TargetSpec } from "./effects";
import type { ObjectId } from "./ids";
import type { ManaCost } from "./mana";
import type { EventLeaves, Predicate, TriggerEvent } from "./predicates";
import type { Keyword, Zone } from "./vocabulary";

export type Cost = Readonly<{
    mana?: ManaCost;
    tap?: boolean;
    sacrificeSelf?: boolean;
}>;

export type Ability =
    | Readonly<{ kind: "keyword"; keyword: Keyword }>
    /** The text of an instant or sorcery. */
    | Readonly<{ kind: "spell"; targets: TargetSpec[]; effects: readonly CardEffect[] }>
    | Readonly<{
          kind: "activated";
          cost: Cost;
          isManaAbility?: boolean; // mana abilities don't use the stack (CR 605)
          targets: TargetSpec[];
          effects: readonly CardEffect[];
          activateableZones: readonly Zone[];
          timingRestriction: "sorcerySpeed" | "instantSpeed";
      }>
    | Readonly<{
          kind: "triggered";
          trigger: EventTrigger;
          targets: TargetSpec[];
          effects: readonly CardEffect[];
          triggerableZones: readonly Zone[];
          isManaAbility?: boolean; // If a triggered ability caused by a mana ability has no target and itself adds mana, it is also a mana ability
      }>
    | Readonly<{ kind: "static"; effect: ContinuousEffectTemplate }>;

export type AbilityOfKind<K extends Ability["kind"]> = Extract<Ability, { kind: K }>;

export interface ActivatableAbilityInfo {
    source: ObjectId;
    ability: AbilityOfKind<"activated">;
    abilityIndex: number;
}

// To ensure bindings are consistent, require that predicates use the same event kind throughout for now,
export type EventTrigger = {
    [K in TriggerEvent]: Readonly<{ event: K; when: Predicate<EventLeaves[K]>; interveningIf?: Condition }>;
}[TriggerEvent];