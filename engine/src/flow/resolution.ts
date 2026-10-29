import { fail, ok, type ApplyResult } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics, isPermanentType } from "../model/characteristics";
import type { ResolvedAnswer } from "../model/decisions";
import type { GameEvent } from "../model/events";
import type { Binding, Frame, GameState, ResolutionInProgress } from "../model/state";
import type { Zone } from "../model/vocabulary";
import { moveObject } from "../model/zones";
import { getEntryEffects, getEntryTargetSpecs } from "../rules/stack";
import { isTargetLegal } from "../rules/targeting";
import { contextOf, executeEffect } from "./effects";
import { givePriorityToActivePlayer } from "./priority";

export function beginResolution(state: GameState): ApplyResult {
    const entry = state.stack[state.stack.length - 1];
    if (!entry) return fail("The stack is empty");

    const next: GameState = { ...state, stack: state.stack.slice(0, -1) };

    const targetSpecs = getEntryTargetSpecs(state, entry);
    const legalTargets = entry.targets.map((spec, i) =>
        spec.map((t) => {
            const targetSpec = targetSpecs[i];
            if (!targetSpec) return false;
            const result = isTargetLegal(next, entry, t, targetSpec.filter);
            return result.ok && result.value;
        }),
    );

    if (legalTargets.some((spec) => spec.length > 0) && !legalTargets.some((spec) => spec.includes(true))) {
        // There was at least one target specified, but no targets were legal - entry fizzles
        const moved = moveObject(next, entry.source, "graveyard");
        if (!moved) return fail("Unable to move fizzled spell to its owner's graveyard");
        const entryName = entry.kind === "spell" ? getCardName(state, entry.source) : entry.sourceSnapshot.chars.name;
        return givePriorityToActivePlayer(moved.state, [{ type: "stackEntryFizzles", id: entry.id, entryName: entryName }, ...moved.events]);
    }

    const resolving: ResolutionInProgress = {
        entry,
        frames: [{ effects: getEntryEffects(state, entry), pc: 0 }],
        legalTargets: legalTargets,
        bindings: {},
    };
    return runResolution({ ...next, resolving });
}

export function runResolution(state: GameState): ApplyResult {
    let currentState: GameState = { ...state, pending: null };
    const out: GameEvent[] = [];
    for (;;) {
        const resolving = currentState.resolving;
        if (!resolving) return fail("Nothing is resolving");
        const topFrame = getTopFrame(currentState);
        if (!topFrame) return finishResolution(currentState, out);
        const effect = topFrame.effects[topFrame.pc];
        if (!effect) {
            currentState = { ...currentState, resolving: { ...resolving, frames: resolving.frames.slice(0, -1) } };
            continue;
        }

        const ctx = contextOf(resolving);
        if (!ctx) return finishResolution(currentState, out);
        const step = executeEffect(currentState, ctx, effect);
        if (!step.ok) return step;
        out.push(...step.events);
        if (step.waiting) return ok(step.state, out); // paused for a decision

        const bindings = step.bind ? withEntry(resolving.bindings, step.bind.bindAs, step.bind.value) : resolving.bindings;
        const advanced = [...resolving.frames.slice(0, -1), { ...topFrame, pc: topFrame.pc + 1 }];
        const frames = step.enter ? [...advanced, ...[...step.enter].reverse()] : advanced; // If effect resulted in new nested effects to resolve, add those at the end and reverse them since ones at the end should resolve first
        currentState = { ...step.state, resolving: { ...resolving, frames, bindings } };
    }
}

export function handleResolutionDecision(state: GameState, bindAs: string, answer: ResolvedAnswer): ApplyResult {
    const resolving = state.resolving;
    if (!resolving) return fail("Nothing is resolving");
    let binding: Binding;
    if (answer.kind === "choose") binding = answer.chosen.map((c) => c.value);
    else if (answer.kind === "yesNo") binding = answer.value;
    else return fail("Unsupported answer for a resolution decision");
    const topFrame = getTopFrame(state);
    if (!topFrame) return fail("No effect frame to bind decision to");
    const advanced = [...resolving.frames.slice(0, -1), { ...topFrame, pc: topFrame.pc + 1 }];
    return runResolution({ ...state, resolving: { ...resolving, frames: advanced, bindings: withEntry(resolving.bindings, bindAs, binding) } });
}

export function finishResolution(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const resolving = state.resolving;
    if (!resolving) return fail("Nothing is resolving");
    let currentState: GameState = { ...state, resolving: null };
    const out: GameEvent[] = [...events];

    if (resolving.entry.kind === "spell" && currentState.objects[resolving.entry.source]?.zone === "stack") {
        const chars = getCharacteristics(currentState, resolving.entry.source);
        if (!chars) return fail("Unable to identify characteristics of resolving spell");
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, entryName: chars.name });
        const dest: Zone = chars.types.some((t) => isPermanentType(t)) ? "battlefield" : "graveyard";
        const moved = moveObject(currentState, resolving.entry.source, dest);
        if (moved) {
            currentState = moved.state;
            out.push(...moved.events);
        }
    } else if (resolving.entry.kind === "ability") {
        // TODO: Ability resolution
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, entryName: "TODO: Ability event names" });
    }
    return givePriorityToActivePlayer(currentState, out);
}

export const getTopFrame = (state: GameState): Frame | undefined => state.resolving?.frames[state.resolving.frames.length - 1];
