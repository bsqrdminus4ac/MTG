import { assertNever } from "../core/util";
import type { GameEvent } from "./events";
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

export type EventLeaves = {
    cardMoved: Readonly<{ kind: "cardMoved"; from?: Zone; to?: Zone; object?: ObjectPredicate }>;
    damageDealt: Readonly<{ kind: "damageDealt"; target?: ObjectPredicate | PlayerPredicate; source?: ObjectPredicate; amount?: NumberTest; isCombatDamage?: boolean }>;
    stepStarted: Readonly<{ kind: "stepStarted"; step: Step; player?: PlayerPredicate }>;
    spellCast: Readonly<{ kind: "spellCast"; by?: PlayerPredicate; spell?: ObjectPredicate }>;
    abilityActivated: Readonly<{ kind: "abilityActivated"; by?: PlayerPredicate; source?: ObjectPredicate }>;
    lifeChanged: Readonly<{ kind: "lifeChanged"; player?: PlayerPredicate; delta?: NumberTest }>;
    attackDeclared: Readonly<{ kind: "attackDeclared"; player?: PlayerPredicate; attacker?: ObjectPredicate }>;
    blockDeclared: Readonly<{ kind: "blockDeclared"; player?: PlayerPredicate; blocker?: ObjectPredicate; attacker?: ObjectPredicate }>;
    cardDrawn: Readonly<{ kind: "cardDrawn"; player?: PlayerPredicate }>;
};

export type TriggerEvent = keyof EventLeaves;
export type TriggerGameEvent = Extract<GameEvent, { type: TriggerEvent }>;
export type EventLeaf = EventLeaves[TriggerEvent];
export type EventPredicate = Predicate<EventLeaf>;

// Must list every key of EventLeaves: a missing or extra key is a compile error
const TRIGGER_EVENT_KEYS: Record<TriggerEvent, true> = {
    cardMoved: true,
    damageDealt: true,
    spellCast: true,
    lifeChanged: true,
    stepStarted: true,
    abilityActivated: true,
    attackDeclared: true,
    blockDeclared: true,
    cardDrawn: true,
};
const TRIGGER_EVENTS: ReadonlySet<string> = new Set(Object.keys(TRIGGER_EVENT_KEYS));

export const isTriggerEvent = (event: GameEvent): event is TriggerGameEvent => TRIGGER_EVENTS.has(event.type);

type AssertExtends<T extends U, U> = T;
type _EventLeafKeysAreGameEvents = AssertExtends<TriggerEvent, GameEvent["type"]>;