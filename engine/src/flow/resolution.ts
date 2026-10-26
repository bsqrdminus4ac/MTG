import { type ApplyResult, fail, ok } from "../core/result";
import { getCharacteristics, isPermanentType } from "../model/characteristics";
import type { ResolvedAnswer } from "../model/decisions";
import type { GameEvent } from "../model/events";
import type { GameState, ResolutionInProgress, Zone } from "../model/state";
import { moveObject } from "../model/zones";
import { contextOf, executeEffect, resolveStackEntryEffects } from "./effects";
import { givePriorityToActivePlayer } from "./priority";

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

export function handleResolutionDecision(state: GameState, answer: ResolvedAnswer): ApplyResult {
    if (!state.resolving) return fail("Nothing is resolving");
    const effect = state.resolving.effects[state.resolving.pc];
    if (effect) {
        //TODO: handle decision (via bindings?)
    }

    return runResolution({ ...state, resolving: { ...state.resolving, pc: state.resolving.pc + 1 } });
}

export function finishResolution(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const resolving = state.resolving;
    if (!resolving) return fail("Nothing is resolving");
    let currentState: GameState = { ...state, resolving: null };
    const out: GameEvent[] = [...events];

    if (resolving.entry.kind === "spell" && currentState.objects[resolving.entry.source]?.zone === "stack") {
        const chars = getCharacteristics(currentState, resolving.entry.source);
        if (!chars) return fail("Unable to identify characteristics of resolving spell");
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, spellName: chars.name });
        const dest: Zone = chars.types.some((t) => isPermanentType(t)) ? "battlefield" : "graveyard";
        const moved = moveObject(currentState, resolving.entry.source, dest);
        if (moved) {
            currentState = moved.state;
            out.push(...moved.events);
        }
    } else if (resolving.entry.kind === "ability") {
        // TODO: Ability resolution
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, spellName: "TODO: Ability event names" });
    }
    return givePriorityToActivePlayer(currentState, out);
}
