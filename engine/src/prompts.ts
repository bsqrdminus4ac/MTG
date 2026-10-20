import type { AbilityOfKind } from "./cards";
import { getCharacteristics } from "./characteristics";
import { priorityDecision, type PriorityOption } from "./decisions";
import type { Decision } from "./decisions";
import { activateAbility } from "./engine";
import type { DecisionId, ObjectId, PlayerId } from "./ids";
import { canPayMana, totalManaPoolCount, type ManaCost, type ManaPool } from "./mana";
import type { GameObject, GameState } from "./state";

/** Stores a new pending decision, issuing it an id from the shared counter. */
export function openDecision(
    state: GameState,
    make: (id: DecisionId) => Decision,
): GameState {
    const id = state.nextId as DecisionId;
    return { ...state, nextId: state.nextId + 1, pending: make(id) };
}

/**
 * Everything this player may legally do right now while holding priority.
 * TODO: castSpell (needs mana payment) and activateAbility.
 */
export function priorityOptions(
    state: GameState,
    player: PlayerId,
): readonly PriorityOption[] {
    const options: PriorityOption[] = [];

    const p = state.players[player];
    if (p && canPlayLand(state, player)) {
        for (const card of p.hand) {
            const chars = getCharacteristics(state, card);
            if (chars?.types.includes("Land")) {
                options.push({
                    id: `play:${card}`,
                    label: `Play ${chars.name}`,
                    action: { type: "playLand", player, card },
                });
            }
        }
    }

    options.push(
        ...getAllActivatableAbilities(state, player).map(
            ({ source, ability, abilityIndex }): PriorityOption => ({
                id: `activate:${source}:${abilityIndex}`,
                label:
                    `Activate ${getCharacteristics(state, source)?.name}'s ability` +
                    (ability.description ? ` (${ability.description})` : ""),
                action: {
                    type: "activateAbility",
                    player,
                    source,
                    abilityIndex,
                }, // TODO: handle targets
            }),
        ),
    );

    options.push(
        ...getCastableSpells(state, player).map(
            (card): PriorityOption => ({
                id: `cast:${card}`,
                label: `Cast ${getCharacteristics(state, card)?.name}`,
                action: { type: "castSpell", player, card, targets: [] }, // TODO: handle targets
            }),
        ),
    );

    options.push({
        id: "pass",
        label: "Pass priority",
        action: { type: "passPriority", player },
    });
    return options;
}

/** Asks the current priority holder what they want to do. Call whenever priority changes hands. */
export function withPriorityDecision(state: GameState): GameState {
    const holder = state.priority?.holder;
    if (holder === undefined) return { ...state, pending: null };
    return openDecision(state, (id) =>
        priorityDecision({
            id,
            player: holder,
            prompt: "You have priority",
            options: priorityOptions(state, holder),
        }),
    );
}

// Helpers

/** Sorcery-speed land drop timing. Doesn't yet account for effects that allow extra land drops. */
export function canPlayLand(state: GameState, player: PlayerId): boolean {
    const p = state.players[player];
    const { activePlayer, step } = state.turn;
    return (
        p !== undefined &&
        player === activePlayer &&
        (step === "precombatMain" || step === "postcombatMain") &&
        state.stack.length === 0 &&
        p.landsPlayedThisTurn < 1
    );
}

export function canPlaySorcerySpeed(
    state: GameState,
    player: PlayerId,
): boolean {
    const { activePlayer, step } = state.turn;
    return (
        player === activePlayer &&
        (step === "precombatMain" || step === "postcombatMain") &&
        state.stack.length === 0
    );
}

export function canPlayInstantSpeed(
    state: GameState,
    player: PlayerId,
): boolean {
    return true; // TODO: check for effects that restrict instant-speed actions
}

export function canActivateAbility(
    state: GameState,
    player: PlayerId,
    source: GameObject,
    ability: AbilityOfKind<"activated">,
): boolean {
    if (!source) return false;
    if (source.controller !== player) return false; // Could potentially have abilities that can be activated by other players, but not yet implemented
    if (!ability.activateableZones.includes(source.zone)) return false;
    if (
        ability.timingRestriction === "sorcerySpeed" &&
        !canPlaySorcerySpeed(state, player)
    )
        return false;
    if (
        ability.timingRestriction === "instantSpeed" &&
        !canPlayInstantSpeed(state, player)
    )
        return false;
    if (ability.cost.tap && source.tapped) return false;
    return true;
}

export interface ActivatableAbilityInfo {
    source: ObjectId;
    ability: AbilityOfKind<"activated">;
    abilityIndex: number;
}

function getAllActivatableAbilities(
    state: GameState,
    player: PlayerId,
): ActivatableAbilityInfo[] {
    const options: ActivatableAbilityInfo[] = [];
    for (const obj of Object.values(state.objects)) {
        const abilities = getCharacteristics(state, obj.id)?.abilities;
        if (!abilities) continue;
        for (let i = 0; i < abilities.length; i++) {
            const ability = abilities[i];
            if (!ability) continue;
            if (
                ability.kind === "activated" &&
                canActivateAbility(state, player, obj, ability)
            ) {
                options.push({
                    source: obj.id,
                    ability: ability,
                    abilityIndex: i,
                });
            }
        }
    }
    return options;
}

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

function getCastableSpells(state: GameState, player: PlayerId): ObjectId[] {
    const castable: ObjectId[] = [];
    const p = state.players[player];
    if (!p) return castable;
    for (const cardId of p.hand) {
        const card = getCharacteristics(state, cardId);
        if (!card) continue;
        if (card.types.includes("Land")) continue; // Land cards are not castable spells
        if (!card.manaCost) continue; // Cards without mana costs cannot be cast
        if (!couldHaveManaToPayCost(state, player, card.manaCost, {})) continue;
        castable.push(cardId);
    }
    return castable;
}