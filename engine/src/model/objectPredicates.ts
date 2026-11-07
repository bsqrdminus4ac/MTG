import { goodResult, type Result } from "../core/result";
import { assertNever } from "../core/util";
import { evalPredicate, type ObjectLeaf, type ObjectPredicate } from "./predicates";
import type { EvalScope, ObjectSnapshot } from "./state";

export const evalObjectPredicate = (scope: EvalScope, obj: ObjectSnapshot, p: ObjectPredicate) => evalPredicate(p, (leaf) => evalObjectLeaf(scope, obj, leaf));

export function evalObjectLeaf(scope: EvalScope, obj: ObjectSnapshot, predicate: ObjectLeaf): Result<boolean> {
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