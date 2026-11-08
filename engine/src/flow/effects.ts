import { applySequentially, fail, goodResult, type ApplyResult, type Failure, type Result } from "../core/result";
import { assertNever, withEntry } from "../core/util";
import { getCardName } from "../model/characteristics";
import type { ObjectMatch } from "../model/continuous";
import { chooseMany, manaChoice, objectChoice, yesNo, type Continuation } from "../model/decisions";
import type { Effect, EffectTarget, PlayerRef } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import type { ManaType } from "../model/mana";
import { getRemainingPlayersInTurnOrder, type Binding, type Bindings, type EvalScope, type Frame, type GameState, type ObjectSnapshot, type Target } from "../model/state";
import { drawCardResult } from "../model/zones";
import { getChoiceBinding, getObjectIdsFromBinding } from "../rules/bindings";
import { evalCondition, resolveAmount } from "../rules/conditions";
import { addContinuousEffect } from "../rules/continuousEffects";
import { openDecision } from "../rules/pending";
import { addManaEffect, damageObject, damagePlayer, destroyPermanent, discardCard, gainLife, loseLife } from "../rules/primitives";

/** Everything an effect can see while its ability resolves. */
export interface EffectContext extends EvalScope {
    readonly targets: readonly (readonly Target[])[];
    readonly legalTargets: readonly (readonly boolean[])[]; // per target index, computed once when resolution starts
    readonly sourceSnapshot: ObjectSnapshot;
    readonly sourceDescription: string; // for logging purposes, e.g. "the activated ability of [card name]"
    readonly resumeAs: "stack" | "mana"; // whether the effect is resolving as part of a stack entry or a mana ability
}

const getSourceName = (state: GameState, ctx: EffectContext): string => {
    if (ctx.sourceSnapshot) return ctx.sourceSnapshot.chars.name;
    return getCardName(state, ctx.source);
};

export const resumeContinuation = (ctx: EffectContext, bindAs: string): Continuation => (ctx.resumeAs === "mana" ? { kind: "resolveManaEffect", bindAs } : { kind: "resolveEffect", bindAs });

export type StepBind = Readonly<{ bindAs: string; value: Binding }>;
export type StepExtras = Readonly<{ bind?: StepBind; enter?: readonly Frame[] }>;

export type StepResult =
    | (Readonly<{ ok: true; waiting: false; state: GameState; events: readonly GameEvent[] }> & StepExtras)
    | Readonly<{ ok: true; waiting: true; state: GameState; events: readonly GameEvent[] }>
    | Failure;

export const done = (state: GameState, events: readonly GameEvent[] = [], extras: StepExtras = {}): StepResult => ({ ok: true, waiting: false, state, events, ...extras });

export const ask = (state: GameState, events: readonly GameEvent[] = []): StepResult => {
    if (!state.pending) return { ok: false, error: "ask() requires a pending decision" };
    return { ok: true, waiting: true, state, events };
};

export const stepFromApply = (result: ApplyResult): StepResult => {
    if (!result.ok) return result;
    return done(result.state, result.events);
};

// advances frames until they're empty or an effect asks for a decision
export function runFrames(
    state: GameState,
    ctx: EffectContext,
    frames: readonly Frame[],
    bindings: Bindings,
):
    | { ok: true; waiting: false; state: GameState; events: readonly GameEvent[]; bindings?: Bindings }
    | { ok: true; waiting: true; state: GameState; events: readonly GameEvent[]; frames: readonly Frame[]; bindings?: Bindings }
    | Failure {
    const out: GameEvent[] = [];
    let currentState = state;
    for (;;) {
        const topFrame = frames[frames.length - 1];
        if (!topFrame) return { ok: true, waiting: false, state: currentState, events: out, bindings };
        const effect = topFrame.effects[topFrame.pc];
        if (!effect) {
            frames = frames.slice(0, -1);
            continue;
        }

        const step = executeEffect(currentState, { ...ctx, bindings }, effect);
        if (!step.ok) return step;
        out.push(...step.events);
        if (step.waiting) return { ok: true, waiting: true, state: step.state, events: out, bindings, frames }; // paused for a decision

        bindings = step.bind ? withEntry(bindings, step.bind.bindAs, step.bind.value) : bindings;
        const advanced = [...frames.slice(0, -1), { ...topFrame, pc: topFrame.pc + 1 }];
        frames = step.enter ? [...advanced, ...[...step.enter].reverse()] : advanced; // If effect resulted in new nested effects to resolve, add those at the end and reverse them since ones at the end should resolve first
        currentState = step.state;
    }
}

//#region Effect Execution

export function executeEffect(state: GameState, ctx: EffectContext, effect: Effect): StepResult {
    let currentState = state;
    switch (effect.kind) {
        //#region Control flow effects
        case "choose": {
            return executeChoiceEffect(state, ctx, effect);
        }
        case "askYesNo":
            return executeYesNoEffect(state, ctx, effect);
        case "if":
            return executeIfEffect(state, ctx, effect);
        case "forEach":
            return executeForEachEffect(state, ctx, effect);
        case "setBinding":
            return done(state, [], { bind: effect });
        //#endregion
        //#region Primitive effects
        case "damage": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;
            return withTargets(currentState, ctx, effect.to, (targets) => {
                return applySequentially(
                    currentState,
                    targets.map((target): ((s: GameState) => ApplyResult) => {
                        if (target.kind === "player") return (s) => damagePlayer(s, target.id, ctx.sourceSnapshot, a.value, false);
                        if (target.kind === "object") return (s) => damageObject(s, target.id, ctx.sourceSnapshot, a.value, false);
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
                        if (target.kind === "object") return (s) => destroyPermanent(s, target.id, ctx.sourceSnapshot, ctx.sourceDescription);
                        return () => fail("Destroying non-permanents has not been implemented yet");
                    }),
                );
            });
        }
        case "addMana": {
            const a = resolveAmount(currentState, ctx, effect.amount);
            if (!a.ok) return a;

            let manaTypes: ManaType[] = [];
            if (effect.mana.kind === "bound") {
                const b = getChoiceBinding(ctx.bindings, effect.mana.name);
                if (!b.ok) return b;
                manaTypes = b.value.flatMap((c) => (c.kind === "mana" ? [c.mana] : []));
            } else {
                manaTypes = [effect.mana.type];
            }
            return stepFromApply(
                applySequentially(
                    currentState,
                    manaTypes.map((manaType) => () => addManaEffect(currentState, ctx.controller, manaType, a.value)),
                ),
            );
        }
        case "discard": {
            const cards = getObjectIdsFromBinding(ctx.bindings, effect.cards.name);
            if (!cards.ok) return cards;
            const cause = `${ctx.controller}'s ${getSourceName(currentState, ctx)}`;
            return stepFromApply(
                applySequentially(
                    currentState,
                    cards.value.map((card) => (s) => discardCard(s, card, cause)),
                ),
            );
        }
        case "applyContinuousEffect": {
            let affects: Readonly<{ kind: "objects"; ids: ObjectId[] }> | ObjectMatch;
            if (effect.template.affects.kind !== "matching") {
                const targets = resolveEffectTargets(currentState, ctx, effect.template.affects);
                if (!targets.ok) return targets;
                affects = { kind: "objects", ids: targets.value.flatMap((t) => (t.kind === "object" ? t.id : [])) };
            } else {
                affects = effect.template.affects;
            }
            return stepFromApply(addContinuousEffect(currentState, ctx, { ...effect.template, affects }));
        }
        //#endregion
        default:
            return assertNever(effect);
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
        if (!options || options.length === 0) return done(state, [], { bind: { bindAs: effect.bindAs, value: [] } }); // Skip decision and bind empty Choice array if no options available

        return ask(
            openDecision(state, (id) =>
                chooseMany({
                    id,
                    options,
                    player: chooser,
                    min: Math.min(options.length, minAmount.value), // Later, if min >= options.length, just add all options to binding without asking
                    max: Math.min(options.length, maxAmount.value),
                    prompt: effect.prompt,
                    then: resumeContinuation(ctx, effect.bindAs),
                }),
            ),
        );
    } else if (effect.from.kind === "manaType") {
        const minAmount = resolveAmount(state, ctx, effect.min);
        if (!minAmount.ok) return fail(minAmount.error);
        const maxAmount = resolveAmount(state, ctx, effect.max);
        if (!maxAmount.ok) return fail(maxAmount.error);

        const options = effect.from.allowed.map((manaType) => manaChoice(manaType, `Add {${manaType}}`));
        if (options.length === 0) return done(state, [], { bind: { bindAs: effect.bindAs, value: [] } }); // Skip decision and bind empty Choice array if no options available

        return ask(
            openDecision(state, (id) =>
                chooseMany({
                    id,
                    options,
                    player: chooser,
                    min: Math.min(options.length, minAmount.value),
                    max: Math.min(options.length, maxAmount.value),
                    prompt: effect.prompt,
                    then: resumeContinuation(ctx, effect.bindAs),
                }),
            ),
        );
    }
    return assertNever(effect.from);
}

function executeYesNoEffect(state: GameState, ctx: EffectContext, effect: Extract<Effect, { kind: "askYesNo" }>): StepResult {
    const chooserResult = resolveEffectTargets(state, ctx, effect.who);
    if (!chooserResult.ok) return fail(chooserResult.error);
    if (chooserResult.value.length > 1) return fail("Chooser of effects must be a single player");
    if (chooserResult.value.length === 0 || chooserResult.value[0]?.kind !== "player") return done(state, [], { bind: { bindAs: effect.bindAs, value: false } }); // If chooser has become illegal, just bind false rather than failing loudly
    const chooser = chooserResult.value[0].id;

    return ask(
        openDecision(state, (id) =>
            yesNo({
                id,
                player: chooser,
                prompt: effect.prompt,
                then: resumeContinuation(ctx, effect.bindAs),
            }),
        ),
    );
}

function executeIfEffect(state: GameState, ctx: EffectContext, effect: Extract<Effect, { kind: "if" }>): StepResult {
    const result = evalCondition(state, ctx, effect.condition);
    if (!result.ok) return result;
    if (result.value) return done(state, [], { enter: [{ effects: effect.then, pc: 0 }] });
    else return effect.else ? done(state, [], { enter: [{ effects: effect.else, pc: 0 }] }) : done(state, []);
}

function executeForEachEffect(state: GameState, ctx: EffectContext, effect: Extract<Effect, { kind: "forEach" }>): StepResult {
    const over = resolveEffectTargets(state, ctx, effect.over);
    if (!over.ok) return over;

    const frames: Frame[] = over.value.map((item) => ({
        effects: [{ kind: "setBinding", bindAs: effect.as, value: [item] }, ...effect.body],
        pc: 0,
    }));
    return done(state, [], { enter: frames });
}

//#endregion

//#region Helpers

export function resolvePlayers(state: GameState, ctx: EffectContext, ref: PlayerRef): PlayerId[] {
    if (ref === "controller") return [ctx.controller];
    if (ref === "owner") {
        const owner = state.objects[ctx.source]?.owner;
        return owner ? [owner] : [];
    }
    if (ref === "eachOpponent") return getRemainingPlayersInTurnOrder(state).filter((p) => p !== ctx.controller) as PlayerId[];
    return getRemainingPlayersInTurnOrder(state) as PlayerId[];
}


function resolveEffectTargets(state: GameState, ctx: EffectContext, t: EffectTarget): Result<Target[]> {
    switch (t.kind) {
        case "target": {
            const targets = ctx.targets[t.spec];
            const legality = ctx.legalTargets[t.spec];
            if (!targets || !legality) return goodResult([]);
            return goodResult(targets.filter((_, i) => legality[i])); // illegal target: the effect does nothing
        }
        case "allTargets":
            return goodResult(
                ctx.targets.flatMap((spec, i) => {
                    const legality = ctx.legalTargets[i];
                    if (!legality) return [];
                    return spec.filter((_, j) => legality[j]);
                }),
            );
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
