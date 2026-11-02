import { fail, ok, type ApplyResult } from "../core/result";
import { withEntry } from "../core/util";
import type { ActivatableAbilityInfo } from "../model/abilities";
import { snapshotSource } from "../model/characteristics";
import type { Decision, ResolvedAnswer } from "../model/decisions";
import { describeAbility } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { canPayMana, type ManaCost, type ManaPool } from "../model/mana";
import type { Binding, Frame, GameState, ManaResolutionInProgress } from "../model/state";
import { findActivatableAbility, getAllActivatableAbilities } from "../rules/abilityQueries";
import { payAbilityCosts } from "../rules/costs";
import { checkStateBasedActions } from "../rules/stateBasedActions";
import { payManaOptions } from "./casting";
import { ask, runFrames, stepFromApply, type EffectContext, type StepResult } from "./effects";
import { withPriorityDecision } from "./priority";

export function getAllManaSources(state: GameState, player: PlayerId, excludeSource?: ObjectId): ActivatableAbilityInfo[] {
    return getAllActivatableAbilities(state, player, excludeSource).filter(({ ability }) => ability.isManaAbility && ability.effects.some((effect) => effect.kind === "addMana"));
}

function hashManaSearchState(pool: ManaPool, abilities: ActivatableAbilityInfo[]) {
    let hash = Object.values(pool).join("|");
    hash =
        hash +
        "^" +
        [...abilities]
            .sort((a, b) => a.source - b.source || a.abilityIndex - b.abilityIndex)
            .map((a) => `${a.source}#${a.abilityIndex}`)
            .join("|");
    return hash;
}

export function couldHaveManaToPayCost(state: GameState, player: PlayerId, cost: ManaCost, searchedStates: { [searchState: string]: boolean }, excludeSource?: ObjectId): boolean {
    const currentPool = state.players[player]?.manaPool;
    if (!currentPool) return false;
    const availableManaAbilities = getAllManaSources(state, player, excludeSource);
    const currentSearchState = hashManaSearchState(currentPool, availableManaAbilities);
    if (currentSearchState in searchedStates) return searchedStates[currentSearchState]!;
    if (canPayMana(currentPool, cost)) {
        searchedStates[currentSearchState] = true;
        return true;
    }
    if (availableManaAbilities.length === 0) {
        searchedStates[currentSearchState] = false;
        return false;
    }

    let couldHaveMana = false;
    for (const ability of availableManaAbilities) {
        const stateToCheck = activateManaAbility(state, player, ability.source, ability.abilityIndex);
        if (canFinishManaAbility(stateToCheck, player, cost, searchedStates, excludeSource)) {
            couldHaveMana = true;
            break;
        }
    }
    searchedStates[currentSearchState] = couldHaveMana;
    return couldHaveMana;
}

function canFinishManaAbility(result: StepResult, player: PlayerId, cost: ManaCost, searchedStates: { [searchState: string]: boolean }, excludeSource?: ObjectId): boolean {
    if (!result.ok) return false;

    if (!result.waiting) {
        return couldHaveManaToPayCost(result.state, player, cost, searchedStates, excludeSource);
    }

    const decision = result.state.pending;
    if (!decision || decision.kind !== "choose" || decision.then.kind !== "resolveManaEffect") return false;
    const bindAs = decision.then.bindAs;

    return answersFor(decision).some((answer) => canFinishManaAbility(handleManaAbilityDecision(result.state, bindAs, answer), player, cost, searchedStates, excludeSource));
}

function answersFor(decision: Decision): ResolvedAnswer[] {
    if (decision.kind === "choose") {
        return decision.options.map((option) => ({ kind: "choose", chosen: [option] }));
    } else if (decision.kind === "yesNo") {
        return [
            { kind: "yesNo", value: true },
            { kind: "yesNo", value: false },
        ];
    }
    return [];
}

export function activateManaAbility(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): StepResult {
    const found = findActivatableAbility(state, player, source, abilityIndex);
    if (!found.ok) return fail(found.error);
    const { chars, ability } = found.value;
    if (!ability.isManaAbility) return fail("That isn't a mana ability");
    if (ability.targets.length > 0) return fail("Mana abilities can't have targets");

    const sourceSnapshot = snapshotSource(state, source); // BEFORE costs: sacrifice moves the source
    if (!sourceSnapshot) return fail("That object is gone");

    // Mana abilities don't use the stack (CR 605). We just resolve it immediately.
    const payResult = payAbilityCosts(state, player, sourceSnapshot, ability);
    if (!payResult.ok) return fail(payResult.error);

    const resolving: ManaResolutionInProgress = {
        player,
        source,
        sourceSnapshot,
        frames: [{ effects: ability.effects, pc: 0 }],
        bindings: {},
        abilityDescription: describeAbility(ability, chars.name),
    };

    return runManaAbilityResolution({ ...payResult.state, resolvingMana: resolving });
}

export function runManaAbilityResolution(state: GameState): StepResult {
    let currentState: GameState = { ...state, pending: null };
    const resolving = currentState.resolvingMana;
    if (!resolving) return fail("No mana ability is resolving");

    const ctx: EffectContext = {
        controller: resolving.player,
        targets: [],
        legalTargets: [],
        source: resolving.source,
        sourceSnapshot: resolving.sourceSnapshot,
        resumeAs: "mana",
        sourceDescription: `the mana ability of ${resolving.sourceSnapshot.chars.name}`,
        bindings: {},
    };

    const result = runFrames(currentState, ctx, resolving.frames, resolving.bindings);
    if (!result.ok) return result;

    if (result.waiting) return ask({ ...result.state, resolvingMana: { ...resolving, frames: result.frames, bindings: result.bindings ?? resolving.bindings } }, result.events);
    return stepFromApply(finishManaAbilityResolution(result.state, result.events));
}

export function handleManaAbilityDecision(state: GameState, bindAs: string, answer: ResolvedAnswer): StepResult {
    const resolving = state.resolvingMana;
    if (!resolving) return fail("No mana ability is resolving");
    let binding: Binding;
    if (answer.kind === "choose") binding = answer.chosen.map((c) => c.value);
    else if (answer.kind === "yesNo") binding = answer.value;
    else return fail("Unsupported answer for a mana ability resolution decision");
    const topFrame = getTopFrame(state);
    if (!topFrame) return fail("No effect frame to bind decision to");
    const advanced = [...resolving.frames.slice(0, -1), { ...topFrame, pc: topFrame.pc + 1 }];
    return runManaAbilityResolution({ ...state, resolvingMana: { ...resolving, frames: advanced, bindings: withEntry(resolving.bindings, bindAs, binding) } });
}

export function finishManaAbilityResolution(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const resolving = state.resolvingMana;
    if (!resolving) return fail("No mana ability is resolving");
    const event: GameEvent = {
        type: "abilityActivated",
        player: resolving.player,
        abilitySource: resolving.sourceSnapshot.id,
        description: resolving.abilityDescription,
        sourceName: resolving.sourceSnapshot.chars.name,
        targets: [],
    };

    if (state.casting) {
        return payManaOptions({ ...state, resolvingMana: null, casting: { ...state.casting, events: [...state.casting.events, event] } });
    }

    const next = { ...state, resolvingMana: null, priority: { holder: resolving.player, consecutivePasses: 0 } };
    const result = checkStateBasedActions(next, [...events, event]);
    if (!result.ok) return result;
    return ok(withPriorityDecision(result.state), result.events);
}

const getTopFrame = (state: GameState): Frame | undefined => state.resolvingMana?.frames[state.resolvingMana.frames.length - 1];