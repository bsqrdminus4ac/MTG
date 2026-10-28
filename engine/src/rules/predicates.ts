import { goodResult, type Result } from "../core/result";
import { assertNever } from "../core/util";
import type { Characteristics } from "../model/cardDefinition";
import type { ObjectId } from "../model/ids";
import type { ObjectPredicate } from "../model/predicates";
import type { EvalScope, GameState } from "../model/state";

export function evalPredicate(state: GameState, scope: EvalScope, objId: ObjectId, chars: Characteristics, predicate: ObjectPredicate): Result<boolean> {
    switch (predicate.kind) {
        case "not":
            const inner = evalPredicate(state, scope, objId, chars, predicate.of);
            return inner.ok ? goodResult(!inner.value) : inner;
        case "all":
        case "any": {
            const values: boolean[] = [];
            for (const sub of predicate.of) {
                // evaluate every one; no short-circuit (see below)
                const v = evalPredicate(state, scope, objId, chars, sub);
                if (!v.ok) return v;
                values.push(v.value);
            }
            return goodResult(predicate.kind === "all" ? values.every(Boolean) : values.some(Boolean));
        }

        case "hasType":
            return goodResult(chars.types.includes(predicate.type));
        case "hasColor":
            return goodResult(chars.colors.includes(predicate.color));
        case "hasSupertype":
            return goodResult(chars.supertypes.includes(predicate.type));
        case "hasSubtype":
            return goodResult(chars.subtypes.includes(predicate.type));
        case "hasKeyword": 
            return goodResult(chars.abilities.some(a => a.kind === "keyword" && a.keyword === predicate.keyword));
        case "controlledBy":
            return goodResult(predicate.who === "you" && state.objects[objId]?.controller === scope.controller);
        case "inZone":
            return goodResult(state.objects[objId]?.zone === predicate.zone);
        default:
            return assertNever(predicate);
    }
}
