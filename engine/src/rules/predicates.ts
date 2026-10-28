import { goodResult, type Result } from "../core/result";
import { assertNever } from "../core/util";
import type { Characteristics } from "../model/cardDefinition";
import { getCharacteristics } from "../model/characteristics";
import type { ObjectId, PlayerId } from "../model/ids";
import { isCombinator, type ObjectLeaf, type ObjectPredicate, type PlayerLeaf, type PlayerPredicate, type Predicate, type StackLeaf, type StackPredicate } from "../model/predicates";
import type { EvalScope, GameState, StackEntry } from "../model/state";

export const evalObjectPredicate = (state: GameState, scope: EvalScope, objId: ObjectId, chars: Characteristics, p: ObjectPredicate) =>
    evalPredicate(p, (leaf) => evalObjectLeaf(state, scope, objId, chars, leaf));

export const evalPlayerPredicate = (state: GameState, scope: EvalScope, player: PlayerId, p: PlayerPredicate) => evalPredicate(p, (leaf) => evalPlayerLeaf(state, scope, player, leaf));

export const evalStackPredicate = (state: GameState, scope: EvalScope, entry: StackEntry, p: StackPredicate) => evalPredicate(p, (leaf) => evalStackLeaf(state, scope, entry, leaf));

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

function evalObjectLeaf(state: GameState, scope: EvalScope, objId: ObjectId, chars: Characteristics, predicate: ObjectLeaf): Result<boolean> {
    switch (predicate.kind) {
        case "hasType":
            return goodResult(chars.types.includes(predicate.type));
        case "hasColor":
            return goodResult(chars.colors.includes(predicate.color));
        case "hasSupertype":
            return goodResult(chars.supertypes.includes(predicate.type));
        case "hasSubtype":
            return goodResult(chars.subtypes.includes(predicate.type));
        case "hasKeyword":
            return goodResult(chars.abilities.some((a) => a.kind === "keyword" && a.keyword === predicate.keyword));
        case "controlledBy":
            return goodResult((predicate.who === "you") === (state.objects[objId]?.controller === scope.controller));
        case "inZone":
            return goodResult(state.objects[objId]?.zone === predicate.zone);
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
            const chars = getCharacteristics(state, entry.source);
            if (!chars) return goodResult(false);
            return evalObjectPredicate(state, scope, entry.source, chars, predicate.of);
        }
        default:
            return assertNever(predicate);
    }
}