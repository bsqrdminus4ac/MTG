import { goodResult, isTrue, type Result } from "../core/result";
import { assertNever } from "../core/util";
import { snapshotObject } from "../model/characteristics";
import type { EventOfType, GameEvent } from "../model/events";
import type { PlayerId } from "../model/ids";
import { evalObjectPredicate } from "../model/objectPredicates";
import {
    compareNumbers,
    evalPredicate,
    type EventLeaf,
    type EventLeaves,
    type EventPredicate,
    type ObjectPredicate,
    type PlayerLeaf,
    type PlayerPredicate,
    type StackLeaf,
    type StackPredicate,
} from "../model/predicates";
import type { EvalScope, GameState, ObjectSnapshot, StackEntry } from "../model/state";

export const evalPlayerPredicate = (state: GameState, scope: EvalScope, player: PlayerId, p: PlayerPredicate) => evalPredicate(p, (leaf) => evalPlayerLeaf(state, scope, player, leaf));

export const evalStackPredicate = (state: GameState, scope: EvalScope, entry: StackEntry, p: StackPredicate) => evalPredicate(p, (leaf) => evalStackLeaf(state, scope, entry, leaf));

export const evalEventPredicate = (state: GameState, scope: EvalScope, event: GameEvent, p: EventPredicate) => evalPredicate(p, (leaf) => evalEventLeaf(state, scope, event, leaf));

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
            const spellSnap = snapshotObject(state, entry.source);
            if (!spellSnap) return goodResult(false);
            return evalObjectPredicate(scope, spellSnap, predicate.of);
        }
        default:
            return assertNever(predicate);
    }
}

function evalEventLeaf(state: GameState, scope: EvalScope, event: GameEvent, predicate: EventLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "cardMoved": {
            if (event.type !== "cardMoved") return goodResult(false);
            const movedObject = moverSnapshot(state, event, predicate);
            return goodResult(
                (!predicate.from || event.from === predicate.from) &&
                    (!predicate.to || event.to === predicate.to) &&
                    (!predicate.object || (movedObject !== undefined && isTrue(evalObjectPredicate(scope, movedObject, predicate.object)))),
            );
        }
        case "damageDealt": {
            if (event.type !== "damageDealt") return goodResult(false);
            if (predicate.target) {
                if (event.target.kind === "object" && (!event.targetLki || !isTrue(evalObjectPredicate(scope, event.targetLki, predicate.target as ObjectPredicate)))) {
                    return goodResult(false);
                } else if (event.target.kind === "player" && !isTrue(evalPlayerPredicate(state, scope, event.target.id, predicate.target as PlayerPredicate))) {
                    return goodResult(false);
                }
            }
            if (predicate.source && !isTrue(evalObjectPredicate(scope, event.sourceLki, predicate.source))) return goodResult(false);
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
                event.type === "spellCast" &&
                    (!predicate.by || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.by))) &&
                    (!predicate.spell || isTrue(evalObjectPredicate(scope, event.spellLki, predicate.spell))),
            );
        case "abilityActivated":
            return goodResult(
                event.type === "abilityActivated" &&
                    (!predicate.by || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.by))) &&
                    (!predicate.source || isTrue(evalObjectPredicate(scope, event.abilitySourceLki, predicate.source))),
            );
        case "lifeChanged":
            return goodResult(
                event.type === "lifeChanged" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.delta || compareNumbers(event.delta, predicate.delta.op, predicate.delta.value)),
            );
        case "attackDeclared":
            return goodResult(
                event.type === "attackDeclared" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.attacker || isTrue(evalObjectPredicate(scope, event.attackerLki, predicate.attacker))),
            );
        case "blockDeclared":
            return goodResult(
                event.type === "blockDeclared" &&
                    (!predicate.player || isTrue(evalPlayerPredicate(state, scope, event.player, predicate.player))) &&
                    (!predicate.blocker || isTrue(evalObjectPredicate(scope, event.blockerLki, predicate.blocker))),
            );
        default:
            assertNever(predicate);
    }
}

function moverSnapshot(state: GameState, event: EventOfType<"cardMoved">, leaf: EventLeaves["cardMoved"]): ObjectSnapshot | undefined {
    const arriving = leaf.to === "battlefield";
    const snap = arriving ? event.after : (event.before ?? event.after);
    return snap ?? snapshotObject(state, event.newId); // may be undefined if the object is gone
}
