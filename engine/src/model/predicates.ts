import type { Color } from "./mana";
import type { CardType, Keyword, Supertype, Zone } from "./vocabulary";

type Combinator<T extends { kind: string }> = { kind: "not"; of: Predicate<T> } | { kind: "all"; of: Predicate<T>[] } | { kind: "any"; of: Predicate<T>[] };
export type Predicate<T extends { kind: string }> = T | Combinator<T>;
export const isCombinator = <T extends { kind: string }>(p: Predicate<T>): p is Combinator<T> => p.kind === "not" || p.kind === "all" || p.kind === "any";

export type ObjectLeaf =
    | Readonly<{ kind: "hasType"; type: CardType }>
    | Readonly<{ kind: "hasColor"; color: Color }>
    | Readonly<{ kind: "hasSupertype"; type: Supertype }>
    | Readonly<{ kind: "hasSubtype"; type: string }>
    | Readonly<{ kind: "hasKeyword"; keyword: Keyword }>
    | Readonly<{ kind: "controlledBy"; who: "you" | "opponent" }>
    | Readonly<{ kind: "inZone"; zone: Zone }>;

export type ObjectPredicate = Predicate<ObjectLeaf>;

export type PlayerLeaf =
    | { kind: "anyPlayer" }
    | { kind: "you" } // relative to scope.controller
    | { kind: "opponent" };

export type PlayerPredicate = Predicate<PlayerLeaf>;

export type StackLeaf = { kind: "isSpell" } | { kind: "isAbility" } | { kind: "controlledBy"; who: "you" | "opponent" } | { kind: "spellMatches"; of: ObjectPredicate }; // runs on the spell's card

export type StackPredicate = Predicate<StackLeaf>; 
