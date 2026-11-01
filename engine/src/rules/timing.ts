import type { Characteristics } from "../model/cardDefinition";
import type { PlayerId } from "../model/ids";
import type { GameState } from "../model/state";

/** Sorcery-speed land drop timing. Doesn't yet account for effects that allow extra land drops. */
export function canPlayLand(state: GameState, player: PlayerId): boolean {
    const p = state.players[player];
    const { activePlayer, step } = state.turn;
    return p !== undefined && player === activePlayer && (step === "precombatMain" || step === "postcombatMain") && state.stack.length === 0 && p.landsPlayedThisTurn < 1;
}

export function canPlaySorcerySpeed(state: GameState, player: PlayerId): boolean {
    const { activePlayer, step } = state.turn;
    return player === activePlayer && (step === "precombatMain" || step === "postcombatMain") && state.stack.length === 0;
}

export function canPlayInstantSpeed(state: GameState, player: PlayerId): boolean {
    return true; // TODO: check for effects that restrict instant-speed actions
}

export function canCastSpellNow(state: GameState, player: PlayerId, chars: Characteristics): boolean {
    if (chars.types.includes("Instant") || chars.abilities.some((a) => a.kind === "keyword" && a.keyword === "flash")) return canPlayInstantSpeed(state, player);
    return canPlaySorcerySpeed(state, player);
}
