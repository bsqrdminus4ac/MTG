import type { ContinuousEffectTemplate } from "./continuous";
import type { ManaType } from "./mana";
import type { PermanentType } from "./vocabulary";

export type PlayerRef = "controller" | "opponent" | "eachPlayer";

export type TargetKinds =
    | Readonly<{ kind: "Permanent"; allowedTypes: PermanentType[] | "any"; zone: "battlefield" }>
    | Readonly<{ kind: "Player"; allowedTypes: "opponent" | "any"; zone: "battlefield" }>
    | Readonly<{ kind: "GraveyardCard"; zone: "graveyard" }>
    | Readonly<{ kind: "StackAbility"; zone: "stack" }>
    | Readonly<{ kind: "AnyTarget"; zone: "battlefield" }>; // Shorthand for player / creature / planeswalker / battle

export type TargetSpec = TargetKinds & { minCount: number; maxCount: number };

export type EffectTarget =
    | Readonly<{ kind: "target"; index: number }> // index into the chosen targets
    | Readonly<{ kind: "self" }>
    | Readonly<{ kind: "player"; who: PlayerRef }>;

export type Effect =
    | Readonly<{ kind: "draw"; who: PlayerRef; count: number }>
    | Readonly<{ kind: "damage"; to: EffectTarget; amount: number }>
    | Readonly<{ kind: "gainLife"; who: PlayerRef; amount: number }>
    | Readonly<{ kind: "loseLife"; who: PlayerRef; amount: number }>
    | Readonly<{ kind: "destroy"; target: EffectTarget }>
    | Readonly<{ kind: "addMana"; mana: ManaType; amount: number }>
    | Readonly<{ kind: "applyContinuousEffect"; template: ContinuousEffectTemplate }>;