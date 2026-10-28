import { applySequentially, fail, goodResult, type ApplyResult, type Failure, type Result } from "../core/result";
import { assertNever } from "../core/util";
import type { Ability } from "../model/abilities";
import { getCardName, getCharacteristics } from "../model/characteristics";
import { chooseMany, objectChoice } from "../model/decisions";
import type { Amount, Effect, EffectTarget, PlayerRef } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { getRemainingPlayersInTurnOrder, type Binding, type Bindings, type Frame, type GameState, type ResolutionInProgress, type StackEntry, type Target } from "../model/state";
import { drawCardResult } from "../model/zones";
import { getChoiceBinding, getCountBinding, getObjectIdsFromBinding } from "../rules/bindings";
import { openDecision } from "../rules/pending";
import { addManaEffect, damageObject, damagePlayer, destroyPermanent, discardCard, gainLife, loseLife } from "../rules/primitives";

/** Enough to evaluate predicates, amounts and player references. Usable at targeting time too. */
interface EvalContext {
    readonly source: ObjectId;
    readonly controller: PlayerId;
}

/** Everything an effect can see while its ability resolves. */
export interface EffectContext extends EvalContext {
    readonly targets: readonly Target[];
    readonly legalTargets: readonly boolean[]; // per target index, computed once when resolution starts
    readonly bindings: Bindings;
}

export type StepResult =
    | Readonly<{ ok: true; waiting: false; state: GameState; events: readonly GameEvent[]; bind?: Readonly<{ bindAs: string; value: Binding }>; enter?: readonly Frame[] }>
    | Readonly<{ ok: true; waiting: true; state: GameState; events: readonly GameEvent[] }>
    | Failure;

export const done = (state: GameState, events: readonly GameEvent[] = [], bind?: { bindAs: string; value: Binding }): StepResult =>
    bind === undefined ? { ok: true, waiting: false, state, events } : { ok: true, waiting: false, state, events, bind };

export const ask = (state: GameState, events: readonly GameEvent[] = []): StepResult => {
    if (!state.pending) return { ok: false, error: "ask() requires a pending decision" };
    return { ok: true, waiting: true, state, events };
};

export const stepFromApply = (result: ApplyResult): StepResult => {
    if (!result.ok) return result;
    return done(result.state, result.events);
};

//#region Effect Execution

export function executeEffect(state: GameState, ctx: EffectContext, effect: Effect): StepResult {
    let currentState = state;
    switch (effect.kind) {
        case "damage": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;
            return withTargets(currentState, ctx, effect.to, (targets) => {
                return applySequentially(
                    currentState,
                    targets.map((target): ((s: GameState) => ApplyResult) => {
                        if (target.kind === "player") return (s) => damagePlayer(s, target.id, ctx.source, a.value, false);
                        if (target.kind === "object") return (s) => damageObject(s, target.id, ctx.source, a.value, false);
                        return () => fail("Damage cannot be dealt to spells/abilities on the stack");
                    }),
                );
            });
        }
        case "draw": {
            const a = resolveAmount(currentState, ctx, effect.count);
            if (!a.ok) return a;
            return withTargets(currentState, ctx, effect.who, (targets) => {
                return applySequentially(
                    currentState,
                    targets.flatMap((target) => {
                        if (target.kind !== "player") return () => fail("Only players can draw cards");
                        return Array.from({ length: a.value }, () => (s) => drawCardResult(s, target.id));
                    }),
                );
            });
        }
        case "gainLife": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;
            return withTargets(currentState, ctx, effect.who, (targets) => {
                return applySequentially(
                    currentState,
                    targets.map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can gain life");
                        return (s) => gainLife(s, target.id, a.value);
                    }),
                );
            });
        }
        case "loseLife": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;
            return withTargets(currentState, ctx, effect.who, (targets) => {
                return applySequentially(
                    currentState,
                    targets.map((target) => {
                        if (target.kind !== "player") return () => fail("Only players can lose life");
                        return (s) => loseLife(s, target.id, a.value);
                    }),
                );
            });
        }
        case "destroy": {
            return withTargets(currentState, ctx, effect.target, (targets) => {
                return applySequentially(
                    currentState,
                    targets.map((target) => {
                        if (target.kind === "object") return (s) => destroyPermanent(s, target.id, ctx.source);
                        return () => fail("Destroying non-permanents has not been implemented yet");
                    }),
                );
            });
        }
        case "addMana": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;
            return stepFromApply(addManaEffect(currentState, ctx.controller, effect.mana, a.value));
        }
        case "discard": {
            const cards = getObjectIdsFromBinding(ctx.bindings, effect.cards.name);
            if (!cards.ok) return cards;
            const cause = `${ctx.controller}'s ${getCardName(currentState, ctx.source)}`;
            return stepFromApply(
                applySequentially(
                    currentState,
                    cards.value.map((card) => (s) => discardCard(s, card, cause)),
                ),
            );
        }
        case "choose": {
            return executeChoiceEffect(state, ctx, effect);
        }
        default:
            return fail(`Resolving effects of kind ${effect.kind} is not implemented yet`);
    }
}

function executeChoiceEffect(state: GameState, ctx: EffectContext, effect: Extract<Effect, { kind: "choose" }>): StepResult {
    const chooserResult = resolveEffectTargets(state, ctx, effect.chooser);
    if (!chooserResult.ok) return fail(chooserResult.error);
    if (chooserResult.value.length !== 1 || chooserResult.value[0]?.kind !== "player") return fail("Chooser of effects must be a single player");
    const chooser = chooserResult.value[0].id;
    if (effect.from.kind === "hand") {
        // Only option for now
        const whoseHandResult = resolveEffectTargets(state, ctx, effect.from.of);
        if (!whoseHandResult.ok) return fail(whoseHandResult.error);
        if (whoseHandResult.value.length !== 1 || whoseHandResult.value[0]?.kind !== "player") return fail("Target of a single hand effect must be a single player");
        const whoseHand = whoseHandResult.value[0].id;

        const minAmount = resolveAmount(state, ctx, effect.min);
        if (!minAmount.ok) return fail(minAmount.error);
        const maxAmount = resolveAmount(state, ctx, effect.max);
        if (!maxAmount.ok) return fail(maxAmount.error);

        const options = state.players[whoseHand]?.hand.map((objId) => objectChoice(objId, getCardName(state, objId)));
        if (!options || options.length === 0) return done(state, [], { bindAs: effect.bindAs, value: [] }); // Skip decision and bind empty Choice array if no options available

        return ask(
            openDecision(state, (id) =>
                chooseMany({
                    id,
                    options,
                    player: chooser,
                    min: Math.min(options.length, minAmount.value), // Later, if min >= options.length, just add all options to binding without asking
                    max: Math.min(options.length, maxAmount.value),
                    prompt: effect.prompt,
                    then: { kind: "resolveEffect", bindAs: effect.bindAs },
                }),
            ),
        );
    }
    return assertNever(effect.from.kind);
}

//#endregion

//#region Helpers

export const contextOf = (resolving: ResolutionInProgress): EffectContext => ({
    source: resolving.entry.source,
    controller: resolving.entry.controller,
    targets: resolving.entry.targets,
    legalTargets: resolving.entry.targets.map(() => true), // real check arrives with isTargetLegal
    bindings: resolving.bindings,
});

export const resolveAmount = (state: GameState, ctx: EffectContext, amount: Amount): Result<number> => {
    return typeof amount === "number" ? goodResult(amount) : getCountBinding(ctx.bindings, amount.name);
};

export function resolvePlayers(state: GameState, ctx: EffectContext, ref: PlayerRef): PlayerId[] {
    if (ref === "controller") return [ctx.controller];
    if (ref === "owner") {
        const owner = state.objects[ctx.source]?.owner;
        return owner ? [owner] : [];
    }
    if (ref === "eachOpponent") return getRemainingPlayersInTurnOrder(state).filter((p) => p !== ctx.controller) as PlayerId[];
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

function resolveEffectTargets(state: GameState, ctx: EffectContext, t: EffectTarget): Result<Target[]> {
    switch (t.kind) {
        case "target": {
            const target = ctx.targets[t.index];
            return goodResult(target && ctx.legalTargets[t.index] ? [target] : []); // illegal target: the effect does nothing
        }
        case "allTargets":
            return goodResult(ctx.targets.filter((_, i) => ctx.legalTargets[i]));
        case "self":
            return goodResult([{ kind: "object", id: ctx.source }]);
        case "player":
            return goodResult(resolvePlayers(state, ctx, t.who).map((id) => ({ kind: "player", id })));
        case "bound":
            return targetsFromBinding(ctx, t.name);

        default:
            return assertNever(t);
    }
}

function targetsFromBinding(ctx: EffectContext, name: string): Result<Target[]> {
    const choices = getChoiceBinding(ctx.bindings, name);
    if (!choices.ok) return choices;
    const targets: Target[] = [];
    for (const choice of choices.value) {
        if (choice.kind === "object") targets.push({ kind: "object", id: choice.id });
        else if (choice.kind === "player") targets.push({ kind: "player", id: choice.id });
    }
    return goodResult(targets);
}

function withTargets(state: GameState, ctx: EffectContext, t: EffectTarget, run: (targets: readonly Target[]) => ApplyResult): StepResult {
    const targets = resolveEffectTargets(state, ctx, t);
    return targets.ok ? stepFromApply(run(targets.value)) : fail(targets.error);
}

//#endregion
