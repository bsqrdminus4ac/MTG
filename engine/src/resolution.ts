import { getCharacteristics, isPermanentType } from "./characteristics";
import { executeEffect, resolveStackEntryEffects } from "./effects";
import { fail, givePriorityToActivePlayer, ok, type ApplyResult, type Resolved } from "./engine";
import type { GameEvent } from "./events";
import type { ObjectId, PlayerId } from "./ids";
import type { Target, GameState, ResolutionInProgress, Binding, Zone } from "./state";
import { moveObject } from "./zones";

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

const contextOf = (resolving: ResolutionInProgress): EffectContext => ({
    source: resolving.entry.source,
    controller: resolving.entry.controller,
    targets: resolving.entry.targets,
    legalTargets: resolving.entry.targets.map(() => true), // real check arrives with isTargetLegal
    bindings: {},
});

export function beginResolution(state: GameState): ApplyResult {
    const entry = state.stack[state.stack.length - 1];
    if (!entry) return fail("The stack is empty");
    const resolving: ResolutionInProgress = {
        entry,
        effects: resolveStackEntryEffects(state, entry),
        pc: 0,
        bindings: {},
    };
    //TODO: Check target legality and trim from entry.targets. If targets were required and no legal targets left, clear effects and let it resolve without any effects

    const next: GameState = { ...state, stack: state.stack.slice(0, -1), resolving };
    return runResolution(next);
}

export function runResolution(state: GameState): ApplyResult {
    let currentState: GameState = { ...state, pending: null };
    const out: GameEvent[] = [];
    for (;;) {
        const resolving = currentState.resolving;
        if (!resolving) return fail("Nothing is resolving");
        const effect = resolving.effects[resolving.pc];
        if (!effect) return finishResolution(currentState, out);
        const ctx = contextOf(resolving);
        if (!ctx) return finishResolution(currentState, out);

        const step = executeEffect(currentState, ctx, effect);
        if (!step.ok) return step;
        out.push(...step.events);
        if (step.waiting) return ok(step.state, out); // paused for a decision
        currentState = { ...step.state, resolving: { ...resolving, pc: resolving.pc + 1 } };
    }
}

export function handleResolutionDecision(state: GameState, answer: Resolved): ApplyResult {
    if (!state.resolving) return fail("Nothing is resolving");
    const effect = state.resolving.effects[state.resolving.pc];
    if (effect) {
         //TODO: handle decision (via bindings?)
    }
    
    return runResolution({...state, resolving: {...state.resolving, pc: state.resolving.pc + 1}});
}

export function finishResolution(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const resolving = state.resolving;
    if (!resolving) return fail("Nothing is resolving");
    let currentState: GameState = { ...state, resolving: null };
    const out: GameEvent[] = [...events];

    if (resolving.entry.kind === "spell" && currentState.objects[resolving.entry.source]?.zone === "stack") {
        const chars = getCharacteristics(currentState, resolving.entry.source);
        if (!chars) return fail("Unable to identify characteristics of resolving spell");
        out.push({type: "stackEntryResolved", id: resolving.entry.id, spellName: chars.name });
        const dest: Zone = chars.types.some((t) => isPermanentType(t)) ? "battlefield" : "graveyard";
        const moved = moveObject(currentState, resolving.entry.source, dest);
        if (moved) {
            currentState = moved.state;
            out.push(...moved.events);
        }
    }
    return givePriorityToActivePlayer(currentState, out);
}
