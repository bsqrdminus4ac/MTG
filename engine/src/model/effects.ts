import type { ContinuousEffectTemplate } from "./continuous";
import type { ManaType } from "./mana";
import type { Binding } from "./state";
import type { PermanentType } from "./vocabulary";

export type BindingRef = { kind: "bound"; name: string };

export type PlayerRef = "controller" | "owner" | "eachOpponent" | "eachPlayer";

export type TargetKinds =
    | Readonly<{ kind: "Permanent"; allowedTypes: PermanentType[] | "any"; zone: "battlefield" }>
    | Readonly<{ kind: "Player"; allowedTypes: "opponent" | "any"; zone: "battlefield" }>
    | Readonly<{ kind: "GraveyardCard"; zone: "graveyard" }>
    | Readonly<{ kind: "StackAbility"; zone: "stack" }>
    | Readonly<{ kind: "AnyTarget"; zone: "battlefield" }>; // Shorthand for player / creature / planeswalker / battle

export type TargetSpec = TargetKinds & { minCount: number; maxCount: number };

export type EffectTarget =
    | Readonly<{ kind: "target"; index: number }> // index into the chosen targets
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
    return effects.flatMap((effect) => effect.description?.trim() ? [effect.description] : []);
}

export const mayDo = (who: EffectTarget, prompt: string, bindAs: string, then: readonly Effect[]): Effect[] => {
    return [
        { kind: "askYesNo", prompt, who, bindAs },
        { kind: "if", condition: { kind: "flag", name: bindAs }, then },
    ];
};

export const YOU: EffectTarget = { kind: "player", who: "controller" };

export type Comparison = ">" | ">=" | "==" | "<" | "<=" | "!=";

export type Condition =
    | { kind: "flag"; name: string } // via getFlag
    | { kind: "compare"; left: Amount; op: Comparison; right: Amount }
    | { kind: "not"; of: Condition }
    | { kind: "all"; of: Condition[] }
    | { kind: "any"; of: Condition[] };

export type Amount = number | BindingRef;