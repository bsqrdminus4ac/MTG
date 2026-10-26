import type { ActivatableAbilityInfo } from "../model/abilities";
import type { PlayerId } from "../model/ids";
import { type ManaCost, type ManaPool, canPayMana } from "../model/mana";
import type { GameState } from "../model/state";
import { activateAbility, getAllActivatableAbilities } from "./abilities";



export function getAllManaSources(
    state: GameState,
    player: PlayerId,
): ActivatableAbilityInfo[] {
    return getAllActivatableAbilities(state, player).filter(
        ({ ability }) =>
            ability.isManaAbility &&
            ability.effects.some((effect) => effect.kind === "addMana"),
    );
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

export function couldHaveManaToPayCost(state: GameState, player: PlayerId, cost: ManaCost, searchedStates: { [searchState: string]: boolean }): boolean {
    const currentPool = state.players[player]?.manaPool;
    if (!currentPool) return false;
    const availableManaAbilities = getAllManaSources(state, player);
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
        const stateToCheck = activateAbility(state, player, ability.source, ability.abilityIndex);
        if (stateToCheck.ok && couldHaveManaToPayCost(stateToCheck.state, player, cost, searchedStates)) {
            couldHaveMana = true;
            break;
        }
    }
    searchedStates[currentSearchState] = couldHaveMana;
    return couldHaveMana;
}