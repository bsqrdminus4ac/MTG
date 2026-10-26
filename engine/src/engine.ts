import { applySequentially, fail, type ApplyResult } from "./core/result";
import { assertNever } from "./core/util";
import { activateAbilityForPriority } from "./flow/abilities";
import { applyAddManaDecision, applyCommitSpellDecision, applyTargetingDecision, beginCast, cancelCast } from "./flow/casting";
import {
    applyAttackSelectionDecision,
    applyAttackTargetDecision,
    applyChooseBlocksDecision,
    applyDamageOrderingDecision,
    beginCombat,
    beginDeclareBlockers,
    cancelAttacks,
    cancelBlocks,
} from "./flow/combat";
import { passPriority, playLand } from "./flow/priority";
import { handleResolutionDecision } from "./flow/resolution";
import { finishDiscard } from "./flow/turn";
import type { Action } from "./model/actions";
import { resolveChooseAnswer, resolveOrderingAnswer, resolvePriorityAnswer, resolveYesNoAnswer, type Continuation, type ResolvedAnswer, type Submission } from "./model/decisions";
import type { PlayerId } from "./model/ids";
import { type GameState } from "./model/state";

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Answer the question the engine is waiting on. UIs and AIs should only ever call this:
 * the engine decides what is legal (by building the decision), and this validates the reply.
 */
export function submitAnswer(state: GameState, submission: Submission): ApplyResult {
    if (state.winner !== null) return fail("The game is over");

    const d = state.pending;
    if (!d) return fail("No decision is waiting");
    if (d.id !== submission.decision) return fail("That decision is no longer current");
    if (d.player !== submission.player) return fail("It isn't your decision");

    if (submission.answer.kind === "cancel") {
        if (!d.onCancel) {
            return fail("This decision cannot be canceled");
        }
        return resume(state, d.onCancel, d.player, { kind: "cancel" });
    }

    switch (d.kind) {
        case "priority": {
            const r = resolvePriorityAnswer(d, submission.answer);
            return r.ok ? applyAction(state, r.value.action) : fail(r.error);
        }
        case "yesNo": {
            const r = resolveYesNoAnswer(d, submission.answer);
            return r.ok ? resume(state, d.then, d.player, { kind: "yesNo", value: r.value }) : fail(r.error);
        }
        case "choose": {
            const r = resolveChooseAnswer(d, submission.answer);
            return r.ok ? resume(state, d.then, d.player, { kind: "choose", chosen: r.value }) : fail(r.error);
        }
        case "order": {
            const r = resolveOrderingAnswer(d, submission.answer);
            return r.ok ? resume(state, d.then, d.player, { kind: "order", options: d.options, order: r.value }) : fail(r.error);
        }
        default:
            return assertNever(d);
    }
}

/**
 * Executes one rules-level command. Lower level than submitAnswer: priority options carry
 * an Action, and answering a priority decision ends up here. Useful for tests and scripted play.
 */
export function applyAction(state: GameState, action: Action): ApplyResult {
    if (state.winner !== null) return fail("The game is over");
    if (state.pending && state.pending.kind !== "priority") return fail("A decision must be answered first");

    switch (action.type) {
        case "passPriority":
            return passPriority(state, action.player);
        case "playLand":
            return playLand(state, action.player, action.card);
        case "castSpell":
            return beginCast(state, action.player, action.card);
        case "activateAbility":
            return activateAbilityForPriority(state, action.player, action.source, action.abilityIndex);
        default:
            return assertNever(action);
    }
}

// ---------------------------------------------------------------------------
// Resuming after a yesNo / choose decision
// ---------------------------------------------------------------------------

function resume(state: GameState, then: Continuation, player: PlayerId, answer: ResolvedAnswer): ApplyResult {
    switch (then.kind) {
        case "discardToHandSize": {
            if (answer.kind !== "choose") return fail("Expected a selection");
            return finishDiscard(state, answer.chosen);
        }
        case "cancelAbility": {
            if (answer.kind !== "cancel") return fail("Expected a cancel answer");
            if (state.casting) {
                return cancelCast(state);
            }
            return fail("Cancelling non-casting decisions is not yet supported");
        }
        case "selectAbilityTargets": {
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyTargetingDecision(state, answer.chosen);
        }
        case "costPayment": {
            if (answer.kind === "choose") {
                return applyAddManaDecision(state, answer.chosen);
            } else if (answer.kind === "yesNo") {
                return applyCommitSpellDecision(state, answer.value);
            } else {
                return fail("Expected a selection or yes/no");
            }
        }
        case "resolveEffect":
            return handleResolutionDecision(state, then.bindAs, answer);
        case "selectAttackers":
            if (answer.kind === "cancel") return cancelAttacks(state, player);
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyAttackSelectionDecision(state, answer.chosen);
        case "selectAttackTargets":
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyAttackTargetDecision(state, answer.chosen);
        case "cancelAttacks":
            return applySequentially(state, [(currentState) => cancelAttacks(currentState, player), beginCombat]);
        case "selectBlockers":
            if (answer.kind === "cancel") return cancelBlocks(state, player);
            if (answer.kind !== "choose") return fail("Expected a selection");
            return applyChooseBlocksDecision(state, player, then.blocker, answer.chosen);
        case "cancelBlocks":
            return applySequentially(state, [(currentState) => cancelBlocks(currentState, player), beginDeclareBlockers]);
        case "selectDamageOrder":
            if (answer.kind !== "order") return fail("Expected an ordering decision");
            return applyDamageOrderingDecision(state, then.attacker, answer.order);
        default:
            return assertNever(then); // narrows to never once every continuation kind has a case
    }
}
