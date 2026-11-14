import type { StaticEffect } from "./continuous";
import type { Condition, Effect, TargetSpec } from "./effects";
import type { EffectId, ObjectId } from "./ids";
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
    | Readonly<{ kind: "spell"; targets: TargetSpec[]; effects: readonly Effect[]; text: string }>
    | Readonly<{
          kind: "activated";
          cost: Cost;
          isManaAbility?: boolean; // mana abilities don't use the stack (CR 605)
          targets: TargetSpec[];
          effects: readonly Effect[];
          activateableZones: readonly Zone[];
          timingRestriction: "sorcerySpeed" | "instantSpeed";
          text: string;
      }>
    | Readonly<{
          kind: "triggered";
          trigger: EventTrigger;
          targets: TargetSpec[];
          effects: readonly Effect[];
          triggerableZones: readonly Zone[];
          isManaAbility?: boolean; // If a triggered ability caused by a mana ability has no target and itself adds mana, it is also a mana ability
          text: string;
      }>
    | Readonly<{ kind: "static"; effect: StaticEffect; activeZones: readonly Zone[] | "all"; text: string }>;

export type AbilityOfKind<K extends Ability["kind"]> = Extract<Ability, { kind: K }>;

export type AbilityRef = { kind: "printed"; index: number } | { kind: "granted"; from: GrantOrigin; index: number };

export type GrantOrigin = { kind: "effect"; id: EffectId } | { kind: "static"; source: ObjectId; ability: AbilityRef }; // the granting static ability's own ref

export interface ActivatableAbilityInfo {
    source: ObjectId;
    ability: AbilityOfKind<"activated">;
    ref: AbilityRef;
}

// To ensure bindings are consistent, require that predicates use the same event kind throughout for now,
export type EventTrigger = {
    [K in TriggerEvent]: Readonly<{ event: K; when: Predicate<EventLeaves[K]>; interveningIf?: Condition }>;
}[TriggerEvent];
