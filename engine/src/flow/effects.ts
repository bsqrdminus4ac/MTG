import { applySequentially, fail, type ApplyResult } from "../core/result";
import { assertNever } from "../core/util";
import type { Ability } from "../model/abilities";
import { getCharacteristics } from "../model/characteristics";
import type { Amount, Effect, EffectTarget, PlayerRef } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { getRemainingPlayersInTurnOrder, type Binding, type GameState, type ResolutionInProgress, type StackEntry, type Target } from "../model/state";
import { drawCardResult } from "../model/zones";
import { addManaEffect, damageObject, damagePlayer, destroyPermanent, gainLife, loseLife } from "../rules/primitives";
import { getBinding } from "./resolution";

/** Enough to evaluate predicates, amounts and player references. Usable at targeting time too. */
interface EvalContext {
    readonly source: ObjectId;
    readonly controller: PlayerId;
}

/** Everything an effect can see while its ability resolves. */
export interface EffectContext extends EvalContext {
    readonly targets: readonly Target[];
    readonly legalTargets: readonly boolean[]; // per target index, computed once when resolution starts
    readonly bindings: Readonly<Record<string, Binding>>;
}

export type StepResult =
    | Readonly<{ ok: true; waiting: false; state: GameState; events: readonly GameEvent[] }>
    | Readonly<{ ok: true; waiting: true; state: GameState; events: readonly GameEvent[] }>
    | Extract<ApplyResult, { ok: false }>;

export const done = (state: GameState, events: readonly GameEvent[] = []): StepResult => ({ ok: true, waiting: false, state, events });

export const ask = (state: GameState, events: readonly GameEvent[] = []): StepResult => {
    if (!state.pending) return { ok: false, error: "ask() requires a pending decision" };
    return { ok: true, waiting: true, state, events };
};

export const stepFromApply = (result: ApplyResult): StepResult => {
    if (!result.ok) return result;
    return done(result.state, result.events);
};

export const contextOf = (resolving: ResolutionInProgress): EffectContext => ({
    source: resolving.entry.source,
    controller: resolving.entry.controller,
    targets: resolving.entry.targets,
    legalTargets: resolving.entry.targets.map(() => true), // real check arrives with isTargetLegal
    bindings: resolving.bindings,
});

export const resolveAmount = (state: GameState, ctx: EffectContext, amount: Amount): { ok: true; amount: number } | { ok: false; error: string } => {
    if (typeof amount === "number") {
        return { ok: true, amount };
    }
    const a = getBinding(ctx, amount.name);
    if (!a.ok) return a;
    if (typeof a.binding === "number") return { ok: true, amount: a.binding };
    else if (typeof a.binding === "boolean") return { ok: false, error: `Invalid numeric value stored for name ${amount.name}` };
    else return { ok: true, amount: a.binding.length };
};

export function resolvePlayers(state: GameState, ctx: EffectContext, ref: PlayerRef): PlayerId[] {
    if (ref === "controller") return [ctx.controller];
    if (ref === "opponent") return getRemainingPlayersInTurnOrder(state).filter((p) => p !== ctx.controller) as PlayerId[];
    return getRemainingPlayersInTurnOrder(state) as PlayerId[];
}

export function resolveStackEntryEffects(state: GameState, entry: StackEntry): readonly Effect[] {
    const chars = getCharacteristics(state, entry.source);
    if (!chars?.abilities) return [];
    let ability: Ability | undefined;
    if (entry.kind === "spell") {
        if (entry.spellIndex) {
            ability = chars.abilities[entry.spellIndex];
            if (ability?.kind !== "spell") return [];
        } else {
            ability = chars.abilities.find((a) => a.kind === "spell");
        }
    } else {
        ability = chars.abilities[entry.abilityIndex];
        if (ability?.kind !== "activated" && ability?.kind !== "triggered") return [];
    }
    return ability?.effects ?? [];
}

function resolveEffectTargets(state: GameState, ctx: EffectContext, t: EffectTarget): readonly Target[] {
    switch (t.kind) {
        case "target": {
            if (t.index == "all") return ctx.targets.filter((_, i) => ctx.legalTargets[i]);
            const target = ctx.targets[t.index];
            return target && ctx.legalTargets[t.index] ? [target] : []; // illegal target: the effect does nothing
        }
        case "self":
            return [{ kind: "object", id: ctx.source }];
        case "player":
            return resolvePlayers(state, ctx, t.who).map((id) => ({ kind: "player", id }));
        default:
            return assertNever(t);
    }
}

export function executeEffect(state: GameState, ctx: EffectContext, effect: Effect): StepResult {
    let currentState = state;
    switch (effect.kind) {
        case "damage": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return fail(a.error);
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, effect.to).map((target): ((s: GameState) => ApplyResult) => {
                        if (target.kind === "player") return (s) => damagePlayer(s, target.id, ctx.source, a.amount, false);
                        if (target.kind === "object") return (s) => damageObject(s, target.id, ctx.source, a.amount, false);
                        return () => fail("Damage cannot be dealt to spells/abilities on the stack");
                    }),
                ),
            );
        }
        case "draw": {
            const a = resolveAmount(currentState, ctx, effect.count);
            if (!a.ok) return fail(a.error);
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).flatMap((target) => {
                        if (target.kind !== "player") return () => fail("Only players can draw cards");
                        return Array.from({ length: a.amount }, () => (s) => drawCardResult(s, target.id));
                    }),
                ),
            );
        }
        case "gainLife": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return fail(a.error);
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can gain life");
                        return (s) => gainLife(s, target.id, a.amount);
                    }),
                ),
            );
        }
        case "loseLife": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return fail(a.error);
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, { kind: "player", who: effect.who }).map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can lose life");
                        return (s) => loseLife(s, target.id, a.amount);
                    }),
                ),
            );
        }
        case "destroy": {
            return stepFromApply(
                applySequentially(
                    currentState,
                    resolveEffectTargets(state, ctx, effect.target).map((target) => {
                        if (target.kind === "object") return (s) => destroyPermanent(s, target.id, ctx.source);
                        return () => fail("Destroying non-permanents has not been implemented yet");
                    }),
                ),
            );
        }
        case "addMana": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return fail(a.error);
            return stepFromApply(addManaEffect(currentState, ctx.controller, effect.mana, a.amount));
        }
        default:
            return fail(`Resolving effects of kind ${effect.kind} is not implemented yet`);
    }
}
