import { fail, isTrue, type ApplyResult } from "../core/result";
import { withEntry } from "../core/util";
import { getCharacteristics, isPermanentType, snapshotObject } from "../model/characteristics";
import type { ResolvedAnswer } from "../model/decisions";
import type { GameEvent } from "../model/events";
import type { Binding, EvalScope, Frame, GameState, ResolutionInProgress } from "../model/state";
import type { Zone } from "../model/vocabulary";
import { moveObject } from "../model/zones";
import { evalCondition } from "../rules/conditions";
import { getEntryName } from "../rules/stack";
import { isTargetLegal } from "../rules/targeting";
import { detectTriggers } from "../rules/triggers";
import { ask, runFrames, type EffectContext } from "./effects";
import { givePriorityToActivePlayer } from "./priority";

export function beginResolution(state: GameState): ApplyResult {
    const entry = state.stack[state.stack.length - 1];
    if (!entry) return fail("The stack is empty");

    const next: GameState = { ...state, stack: state.stack.slice(0, -1) };
    let fizzleReason: false | "lackOfTargets" | "interveningIf" = false;
    const targetSpecs = entry.ability.targets;
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
        fizzleReason = "lackOfTargets";
    } else if (entry.kind === "ability" && entry.ability.kind === "triggered" && entry.ability.trigger.interveningIf) {
        const scope: EvalScope = {
            source: entry.source,
            controller: entry.controller,
            bindings: entry.bindings,
        };
        // Intervening if clause no longer valid - entry fizzles
        if (!isTrue(evalCondition(state, scope, entry.ability.trigger.interveningIf))) fizzleReason = "interveningIf";
    }

    if (fizzleReason) {
        const entryName: string = getEntryName(next, entry);
        if (entry.kind === "spell") {
            const moved = moveObject(next, entry.source, "graveyard");
            if (!moved) return fail("Unable to move fizzled spell to its owner's graveyard");
            return givePriorityToActivePlayer(moved.state, [{ type: "stackEntryFizzles", id: entry.id, entryName, reason: fizzleReason }, ...moved.events]);
        } else {
            return givePriorityToActivePlayer(next, [{ type: "stackEntryFizzles", id: entry.id, entryName, reason: fizzleReason }]);
        }
    }

    const sourceSnapshot = entry.kind === "ability" ? entry.sourceSnapshot : snapshotObject(state, entry.source);
    if (!sourceSnapshot) return fail("Unable to acquire snapshot of spell's source");
    const resolving: ResolutionInProgress = {
        entry,
        frames: [{ effects: entry.ability.effects, pc: 0 }],
        legalTargets: legalTargets,
        bindings: entry.bindings,
        sourceSnapshot,
    };
    return runResolution({ ...next, resolving });
}

export function runResolution(state: GameState): ApplyResult {
    let currentState: GameState = { ...state, pending: null };
    const resolving = currentState.resolving;
    if (!resolving) return fail("Nothing is resolving");

    const ctx: EffectContext = {
        source: resolving.entry.source,
        controller: resolving.entry.controller,
        targets: resolving.entry.targets,
        legalTargets: resolving.legalTargets, // real check arrives with isTargetLegal
        bindings: resolving.bindings,
        sourceSnapshot: resolving.sourceSnapshot,
        sourceDescription: resolving.entry.kind === "ability" ? `the ${resolving.entry.ability.kind} ability of ${resolving.sourceSnapshot.chars.name}` : `${resolving.sourceSnapshot.chars.name}`,
        resumeAs: "stack",
    };

    const result = runFrames(currentState, ctx, resolving.frames, resolving.bindings);
    if (!result.ok) return result;

    if (result.waiting) {
        currentState = { ...result.state, resolving: { ...resolving, frames: result.frames, bindings: result.bindings ?? resolving.bindings } };
        const triggerState = detectTriggers(currentState, result.events);
        if (!triggerState.ok) return triggerState;
        return ask(triggerState.state, triggerState.events);
    } else {
        return finishResolution(result.state, result.events);
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
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, entryName: getEntryName(state, resolving.entry) });
        const dest: Zone = chars.types.some((t) => isPermanentType(t)) ? "battlefield" : "graveyard";
        const moved = moveObject(currentState, resolving.entry.source, dest);
        if (moved) {
            currentState = moved.state;
            out.push(...moved.events);
        }
    } else if (resolving.entry.kind === "ability") {
        out.push({ type: "stackEntryResolved", id: resolving.entry.id, entryName: getEntryName(state, resolving.entry) });
    }
    return givePriorityToActivePlayer(currentState, out);
}

const getTopFrame = (state: GameState): Frame | undefined => state.resolving?.frames[state.resolving.frames.length - 1];
