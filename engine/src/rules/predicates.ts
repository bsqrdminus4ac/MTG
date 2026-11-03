import { goodResult, isTrue, type Result } from "../core/result";
import { assertNever } from "../core/util";
import { snapshotSource } from "../model/characteristics";
import type { GameEvent } from "../model/events";
import type { PlayerId } from "../model/ids";
import {
    compareNumbers,
    isCombinator,
    type EventLeaf,
    type EventPredicate,
    type ObjectLeaf,
    type ObjectPredicate,
    type PlayerLeaf,
    type PlayerPredicate,
    type Predicate,
    type StackLeaf,
    type StackPredicate,
} from "../model/predicates";
import type { EvalScope, GameState, ObjectSnapshot, StackEntry } from "../model/state";

export const evalObjectPredicate = (state: GameState, scope: EvalScope, obj: ObjectSnapshot, p: ObjectPredicate) => evalPredicate(p, (leaf) => evalObjectLeaf(state, scope, obj, leaf));

export const evalPlayerPredicate = (state: GameState, scope: EvalScope, player: PlayerId, p: PlayerPredicate) => evalPredicate(p, (leaf) => evalPlayerLeaf(state, scope, player, leaf));

export const evalStackPredicate = (state: GameState, scope: EvalScope, entry: StackEntry, p: StackPredicate) => evalPredicate(p, (leaf) => evalStackLeaf(state, scope, entry, leaf));

export const evalEventPredicate = (state: GameState, scope: EvalScope, event: GameEvent, p: EventPredicate) => evalPredicate(p, (leaf) => evalEventLeaf(state, scope, event, leaf));

export function evalPredicate<T extends { kind: string }>(predicate: Predicate<T>, evalFunc: (leaf: T) => Result<boolean>): Result<boolean> {
    if (!isCombinator(predicate)) return evalFunc(predicate);
    switch (predicate.kind) {
        case "not":
            const inner = evalPredicate(predicate.of, evalFunc);
            return inner.ok ? goodResult(!inner.value) : inner;
        case "all":
        case "any": {
            const values: boolean[] = [];
            for (const sub of predicate.of) {
                // evaluate every one; no short-circuit (see below)
                const v = evalPredicate(sub, evalFunc);
                if (!v.ok) return v;
                values.push(v.value);
            }
            return goodResult(predicate.kind === "all" ? values.every(Boolean) : values.some(Boolean));
        }
    }
}

function evalObjectLeaf(state: GameState, scope: EvalScope, obj: ObjectSnapshot, predicate: ObjectLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "hasType":
            return goodResult(obj.chars.types.includes(predicate.type));
        case "hasColor":
            return goodResult(obj.chars.colors.includes(predicate.color));
        case "hasSupertype":
            return goodResult(obj.chars.supertypes.includes(predicate.type));
        case "hasSubtype":
            return goodResult(obj.chars.subtypes.includes(predicate.type));
        case "hasKeyword":
            return goodResult(obj.chars.abilities.some((a) => a.kind === "keyword" && a.keyword === predicate.keyword));
        case "controlledBy":
            return goodResult((predicate.who === "you") === (obj.controller === scope.controller));
        case "inZone":
            return goodResult(obj.zone === predicate.zone);
        case "isSource":
            return goodResult(obj.id === scope.source);
        default:
            return assertNever(predicate);
    }
}

function evalPlayerLeaf(state: GameState, scope: EvalScope, player: PlayerId, predicate: PlayerLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "anyPlayer":
            return goodResult(true);
        case "you":
            return goodResult(scope.controller === player);
        case "opponent":
            return goodResult(scope.controller !== player);
        default:
            return assertNever(predicate);
    }
}

function evalStackLeaf(state: GameState, scope: EvalScope, entry: StackEntry, predicate: StackLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "isAbility":
            return goodResult(entry.kind === "ability");
        case "isSpell":
            return goodResult(entry.kind === "spell");
        case "controlledBy":
            return goodResult((predicate.who === "you") === (entry.controller === scope.controller));
        case "spellMatches": {
            if (entry.kind !== "spell") return goodResult(false);
            const spellSnap = snapshotSource(state, entry.source);
            if (!spellSnap) return goodResult(false);
            return evalObjectPredicate(state, scope, spellSnap, predicate.of);
        }
        default:
            return assertNever(predicate);
    }
}

function evalEventLeaf(state: GameState, scope: EvalScope, event: GameEvent, predicate: EventLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "moved":
            return goodResult(
                event.type === "cardMoved" &&
                    (!predicate.from || event.from === predicate.from) &&
                    (!predicate.to || event.to === predicate.to) &&
                    (!predicate.object || (event.lki !== undefined && isTrue(evalObjectPredicate(state, scope, event.lki, predicate.object)))),
            );
        case "damaged": {
            if (event.type !== "damageDealt") return goodResult(false);
            if (predicate.target) {
                if (event.target.kind === "object" && (!event.targetLki || !isTrue(evalObjectPredicate(state, scope, event.targetLki, predicate.target as ObjectPredicate)))) {
                    return goodResult(false);
                } else if (event.target.kind === "player" && !isTrue(evalPlayerPredicate(state, scope, event.target.id, predicate.target as PlayerPredicate))) {
                    return goodResult(false);
                }
            }
            if (predicate.source && !isTrue(evalObjectPredicate(state, scope, event.sourceLki, predicate.source))) return goodResult(false);
            if (predicate.amount && !compareNumbers(event.amount, predicate.amount.op, predicate.amount.value)) return goodResult(false);
            if (predicate.isCombatDamage !== undefined && event.isCombatDamage !== predicate.isCombatDamage) return goodResult(false);
            return goodResult(true);
        }
        case "stepStarted":
            return goodResult(event.type === "stepStarted" && event.step === predicate.step && (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.activePlayer, predicate.player))));
        case "cardDrawn":
            return goodResult(event.type === "cardDrawn" && (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))));
        case "spellCast":
            return goodResult(
                event.type === "spellCastSuccess" &&
                    (!predicate.by || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.by))) &&
                    (!predicate.spell || isTrue(evalObjectPredicate(state, scope, event.spellLki, predicate.spell))),
            );
        case "abilityActivated":
            return goodResult(
                event.type === "abilityActivated" &&
                    (!predicate.by || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.by))) &&
                    (!predicate.source || isTrue(evalObjectPredicate(state, scope, event.abilitySourceLki, predicate.source))),
            );
        case "lifeChanged":
            return goodResult(
                event.type === "lifeChanged" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.delta || compareNumbers(event.delta, predicate.delta.op, predicate.delta.value)),
            );
        case "attacked":
            return goodResult(
                event.type === "attackDeclared" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.attacker || isTrue(evalObjectPredicate(state, scope, event.attackerLki, predicate.attacker))),
            );
        case "blocked":
            return goodResult(
                event.type === "blockDeclared" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.blocker || isTrue(evalObjectPredicate(state, scope, event.blockerLki, predicate.blocker))),
            );
        default:
            assertNever(predicate);
    }
}
