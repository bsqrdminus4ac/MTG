import { assertNever } from "../core/util";
import type { Color } from "./mana";
import type { CardType, Keyword, Step, Supertype, Zone } from "./vocabulary";

type Combinator<T extends { kind: string }> = { kind: "not"; of: Predicate<T> } | { kind: "all"; of: Predicate<T>[] } | { kind: "any"; of: Predicate<T>[] };
export type Predicate<T extends { kind: string }> = T | Combinator<T>;
export const isCombinator = <T extends { kind: string }>(p: Predicate<T>): p is Combinator<T> => p.kind === "not" || p.kind === "all" || p.kind === "any";

export type Comparison = ">" | ">=" | "==" | "<" | "<=" | "!=";

type NumberTest = { op: Comparison; value: number };

export function compareNumbers(a: number, op: Comparison, b: number): boolean {
    switch (op) {
        case "<":
            return a < b;
        case "<=":
            return a <= b;
        case "==":
            return a === b;
        case "!=":
            return a !== b;
        case ">=":
            return a >= b;
        case ">":
            return a > b;
        default:
            return assertNever(op);
    }
}

export type ObjectLeaf =
    | Readonly<{ kind: "hasType"; type: CardType }>
    | Readonly<{ kind: "hasColor"; color: Color }>
    | Readonly<{ kind: "hasSupertype"; type: Supertype }>
    | Readonly<{ kind: "hasSubtype"; type: string }>
    | Readonly<{ kind: "hasKeyword"; keyword: Keyword }>
    | Readonly<{ kind: "controlledBy"; who: "you" | "opponent" }>
    | Readonly<{ kind: "inZone"; zone: Zone }>
    | Readonly<{ kind: "isSource" }>;

export type ObjectPredicate = Predicate<ObjectLeaf>;

export type PlayerLeaf =
    | { kind: "anyPlayer" }
    | { kind: "you" } // relative to scope.controller
    | { kind: "opponent" };

export type PlayerPredicate = Predicate<PlayerLeaf>;

export type StackLeaf = { kind: "isSpell" } | { kind: "isAbility" } | { kind: "controlledBy"; who: "you" | "opponent" } | { kind: "spellMatches"; of: ObjectPredicate }; // runs on the spell's card

export type StackPredicate = Predicate<StackLeaf>;

export type EventLeaf =
    | Readonly<{ kind: "moved"; from?: Zone; to?: Zone; object?: ObjectPredicate }>
    | Readonly<{ kind: "damaged"; target?: ObjectPredicate | PlayerPredicate; source?: ObjectPredicate; amount?: NumberTest; isCombatDamage?: boolean }>
    | Readonly<{ kind: "stepStarted"; step: Step; player?: PlayerPredicate }>
    | Readonly<{ kind: "spellCast"; by?: PlayerPredicate; spell?: ObjectPredicate }>
    | Readonly<{ kind: "abilityActivated"; by?: PlayerPredicate; source?: ObjectPredicate }>
    | Readonly<{ kind: "lifeChanged"; player?: PlayerPredicate; delta?: NumberTest }>
    | Readonly<{ kind: "attacked"; player?: PlayerPredicate; attacker?: ObjectPredicate }>
    | Readonly<{ kind: "blocked"; player?: PlayerPredicate; blocker?: ObjectPredicate; attacker?: ObjectPredicate }>
    | Readonly<{ kind: "cardDrawn"; player?: PlayerPredicate }>;

export type EventPredicate = Predicate<EventLeaf>;
