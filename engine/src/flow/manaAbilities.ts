import { fail, ok, type ApplyResult } from "../core/result";
import type { ActivatableAbilityInfo } from "../model/abilities";
import { snapshotSource } from "../model/characteristics";
import { describeAbility } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { canPayMana, type ManaCost, type ManaPool } from "../model/mana";
import type { GameState } from "../model/state";
import { findActivatableAbility, getAllActivatableAbilities } from "../rules/abilityQueries";
import { payAbilityCosts } from "../rules/costs";
import { runFrames, type EffectContext } from "./effects";

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
        if (stateToCheck.ok && couldHaveManaToPayCost(stateToCheck.state, player, cost, searchedStates, excludeSource)) {
            couldHaveMana = true;
            break;
        }
    }
    searchedStates[currentSearchState] = couldHaveMana;
    return couldHaveMana;
}

export function activateManaAbility(state: GameState, player: PlayerId, source: ObjectId, abilityIndex: number): ApplyResult {
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
    const ctx: EffectContext = {
        controller: player,
        targets: [],
        legalTargets: [],
        source,
        sourceSnapshot,
        bindings: {},
    };
    const resolveResult = runFrames(payResult.state, ctx, [{ effects: ability.effects, pc: 0 }], {});
    if (!resolveResult.ok) return fail(resolveResult.error);
    if (resolveResult.waiting) return fail("Mana abilities cannot make decisions yet");
    const next = {
        ...resolveResult.state,
        priority: { holder: player, consecutivePasses: 0 },
    };
    const event: GameEvent = {
        type: "abilityActivated",
        player: player,
        abilitySource: sourceSnapshot.id,
        description: describeAbility(ability, sourceSnapshot.chars.name),
        sourceName: sourceSnapshot.chars.name,
        targets: [],
    };
    return ok(next, [...payResult.events, event, ...resolveResult.events]);
}
