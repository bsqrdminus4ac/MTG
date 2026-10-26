import type { AbilityOfKind } from "../model/abilities";
import type { PlayerId } from "../model/ids";
import type { GameObject, GameState } from "../model/state";

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