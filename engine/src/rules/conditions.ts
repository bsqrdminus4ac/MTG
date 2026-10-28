import { type Result, goodResult } from "../core/result";
import { assertNever } from "../core/util";
import type { Amount, Comparison, Condition } from "../model/effects";
import type { ObjectId, PlayerId } from "../model/ids";
import type { Bindings, GameState } from "../model/state";
import { getCountBinding, getFlagBinding } from "./bindings";

export interface EvalScope { bindings: Bindings; controller: PlayerId; source: ObjectId }

export const resolveAmount = (state: GameState, ctx: EvalScope, amount: Amount): Result<number> => {
    return typeof amount === "number" ? goodResult(amount) : getCountBinding(ctx.bindings, amount.name);
};

export function evalCondition(state: GameState, scope: EvalScope, c: Condition): Result<boolean> {
    switch (c.kind) {
        case "flag":
            return getFlagBinding(scope.bindings, c.name);
        case "compare": {
            const left = resolveAmount(state, scope, c.left);
            if (!left.ok) return left;
            const right = resolveAmount(state, scope, c.right);
            if (!right.ok) return right;
            return goodResult(compareNumbers(left.value, c.op, right.value));
        }
        case "not": {
            const inner = evalCondition(state, scope, c.of);
            return inner.ok ? goodResult(!inner.value) : inner;
        }
        case "all":
        case "any": {
            const values: boolean[] = [];
            for (const sub of c.of) {
                // evaluate every one; no short-circuit (see below)
                const v = evalCondition(state, scope, sub);
                if (!v.ok) return v;
                values.push(v.value);
            }
            return goodResult(c.kind === "all" ? values.every(Boolean) : values.some(Boolean));
        }
        default:
            return assertNever(c);
    }
}

function compareNumbers(a: number, op: Comparison, b: number): boolean {
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