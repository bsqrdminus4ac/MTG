import { type Result, goodResult } from "../core/result";
import { assertNever } from "../core/util";
import { getCharacteristics, hasKeyword } from "../model/characteristics";
import type { TargetFilter, TargetSpec } from "../model/effects";
import type { EvalScope, GameState, Target } from "../model/state";
import { evalObjectPredicate, evalPlayerPredicate, evalStackPredicate } from "./predicates";

export function canBeTargetedBy(state: GameState, scope: EvalScope, target: Target): boolean {
    if (target.kind === "object") {
        const obj = state.objects[target.id];
        if (!obj) return false;
        if (obj.controller !== scope.controller) {
            if (hasKeyword(state, target.id, "hexproof")) return false;
        }
    }
    return true;
}

export function isTargetLegal(state: GameState, scope: EvalScope, target: Target, filter: TargetFilter): Result<boolean> {
    if (!canBeTargetedBy(state, scope, target)) return goodResult(false);
    return matchesFilter(state, scope, target, filter);
}

function matchesFilter(state: GameState, scope: EvalScope, target: Target, filter: TargetFilter): Result<boolean> {
    switch (filter.kind) {
        case "anyOf":
            for (const sub of filter.of) {
                const result = matchesFilter(state, scope, target, sub);
                if (!result.ok || result.value) return result;
            }
            return goodResult(false);
        case "player":
            if (target.kind !== "player") return goodResult(false);
            if (!state.players[target.id]) return goodResult(false);
            return evalPlayerPredicate(state, scope, target.id, filter.filter);
        case "stackEntry":
            if (target.kind !== "stackEntry") return goodResult(false);
            const entry = state.stack.find((entry) => entry.id === target.id);
            if (!entry) return goodResult(false);
            return evalStackPredicate(state, scope, entry, filter.filter);
        case "object":
            if (target.kind !== "object") return goodResult(false);
            if (!state.objects[target.id]) return goodResult(false);
            const chars = getCharacteristics(state, target.id);
            if (!chars) return goodResult(false);
            return evalObjectPredicate(state, scope, target.id, chars, filter.filter);
        default:
            return assertNever(filter);
    }
}

const targetKey = (t: Target): string => `${t.kind}:${t.id}`;

export function getLegalTargets(state: GameState, scope: EvalScope, spec: TargetSpec): Result<readonly Target[]> {
    const seen = new Set<string>();
    const out: Target[] = [];
    const candidates = collectTargets(state, scope, spec.filter);
    if (!candidates.ok) return candidates;
    for (const t of candidates.value) {
        const key = targetKey(t);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(t);
    }
    return goodResult(out);
}

function collectTargets(state: GameState, scope: EvalScope, filter: TargetFilter): Result<readonly Target[]> {
    switch (filter.kind) {
        case "anyOf": {
            const targets: Target[] = [];
            for (const subfilter of filter.of) {
                const result = collectTargets(state, scope, subfilter);
                if (!result.ok) return result;
                targets.push(...result.value);
            }
            return goodResult(targets);
        }
        case "player": {
            const targets: Target[] = [];
            for (const player of Object.values(state.players)) {
                const matches = evalPlayerPredicate(state, scope, player.id, filter.filter);
                if (!matches.ok) return matches;
                if (matches.value) targets.push({ kind: "player", id: player.id });
            }
            return goodResult(targets);
        }
        case "object": {
            const targets: Target[] = [];
            for (const obj of Object.values(state.objects)) {
                const chars = getCharacteristics(state, obj.id);
                if (!chars) continue;
                const matches = evalObjectPredicate(state, scope, obj.id, chars, filter.filter);
                if (!matches.ok) return matches;
                if (matches.value) targets.push({ kind: "object", id: obj.id });
            }
            return goodResult(targets);
        }
        case "stackEntry": {
            const targets: Target[] = [];
            for (const entry of state.stack) {
                const matches = evalStackPredicate(state, scope, entry, filter.filter);
                if (!matches.ok) return matches;
                if (matches.value) targets.push({ kind: "stackEntry", id: entry.id });
            }
            return goodResult(targets);
        }
        default:
            return assertNever(filter);
    }
}
