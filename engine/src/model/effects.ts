import type { ContinuousEffectTemplate } from "./continuous";
import type { ManaType } from "./mana";
import type { ObjectPredicate, PlayerPredicate, Predicate, StackPredicate } from "./predicates";
import type { Binding } from "./state";
import { DAMAGEABLE_TYPES, type PermanentType } from "./vocabulary";

export type BindingRef = { kind: "bound"; name: string };

export type PlayerRef = "controller" | "owner" | "eachOpponent" | "eachPlayer";

export type TargetFilter =
    | { kind: "player"; filter: PlayerPredicate }
    | { kind: "object"; filter: ObjectPredicate }
    | { kind: "stackEntry"; filter: StackPredicate }
    | { kind: "anyOf"; of: TargetFilter[] };

export type TargetSpec = { filter: TargetFilter; minCount: number; maxCount: number; description?: string };

export const permanentOfType = (allowedTypes: PermanentType[] | "any"): TargetFilter => {
    const inBattlefield: ObjectPredicate = { kind: "inZone", zone: "battlefield" };
    if (allowedTypes === "any") return { kind: "object", filter: inBattlefield };

    return {
        kind: "object",
        filter: {
            kind: "all",
            of: [inBattlefield, { kind: "any", of: allowedTypes.map((type): ObjectPredicate => ({ kind: "hasType", type })) }],
        },
    };
};

export const anyTarget = (): TargetFilter => {
    return {
        kind: "anyOf",
        of: [{ kind: "player", filter: { kind: "anyPlayer" } }, permanentOfType(DAMAGEABLE_TYPES)],
    };
};

export type EffectTarget =
    | Readonly<{ kind: "target"; spec: number }> // index into the chosen targets
    | Readonly<{ kind: "allTargets" }>
    | Readonly<{ kind: "self" }>
    | Readonly<{ kind: "player"; who: PlayerRef }>
    | Readonly<{ kind: "bound"; name: string }>;

type ControlFlowEffect =
    | Readonly<{ kind: "choose"; chooser: EffectTarget; from: { kind: "hand"; of: EffectTarget }; min: Amount; max: Amount; bindAs: string; prompt: string }>
    | Readonly<{ kind: "if"; condition: Condition; then: readonly Effect[]; else?: readonly Effect[] }>
    | Readonly<{ kind: "forEach"; over: EffectTarget; as: string; body: readonly Effect[] }>
    | Readonly<{ kind: "askYesNo"; who: EffectTarget; prompt: string; bindAs: string }>;

type PrimitiveEffect =
    | Readonly<{ kind: "draw"; who: EffectTarget; count: Amount }>
    | Readonly<{ kind: "damage"; to: EffectTarget; amount: Amount }>
    | Readonly<{ kind: "gainLife"; who: EffectTarget; amount: Amount }>
    | Readonly<{ kind: "loseLife"; who: EffectTarget; amount: Amount }>
    | Readonly<{ kind: "destroy"; target: EffectTarget }>
    | Readonly<{ kind: "addMana"; mana: ManaType; amount: Amount }>
    | Readonly<{ kind: "discard"; cards: BindingRef }>
    | Readonly<{ kind: "applyContinuousEffect"; template: ContinuousEffectTemplate }>;

// Internal, not for card authors
type InternalEffect = Readonly<{ kind: "setBinding"; bindAs: string; value: Binding }>;

export type Effect = ControlFlowEffect | PrimitiveEffect | InternalEffect;

export type CardEffect = Effect & { readonly description?: string };

export function getCardText(effects: readonly CardEffect[]): string[] {
    return effects.flatMap((effect) => (effect.description?.trim() ? [effect.description] : []));
}

export const mayDo = (who: EffectTarget, prompt: string, bindAs: string, then: readonly Effect[]): Effect[] => {
    return [
        { kind: "askYesNo", prompt, who, bindAs },
        { kind: "if", condition: { kind: "flag", name: bindAs }, then },
    ];
};

export const YOU: EffectTarget = { kind: "player", who: "controller" };

export type Comparison = ">" | ">=" | "==" | "<" | "<=" | "!=";

type ConditionLeaf = { kind: "flag"; name: string } | { kind: "compare"; left: Amount; op: Comparison; right: Amount };

export type Condition = Predicate<ConditionLeaf>;

export type Amount = number | BindingRef;