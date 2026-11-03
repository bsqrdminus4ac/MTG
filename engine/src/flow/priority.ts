import { type ApplyResult, fail, ok } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics } from "../model/characteristics";
import { type PriorityOption, priorityDecision } from "../model/decisions";
import { describeAbility } from "../model/effects";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { type GameState, nextPlayer } from "../model/state";
import { moveObject } from "../model/zones";
import { getAllActivatableAbilities } from "../rules/abilityQueries";
import { openDecision } from "../rules/pending";
import { checkStateBasedActions } from "../rules/stateBasedActions";
import { canPlayLand } from "../rules/timing";
import { checkActivatable, checkCastable } from "./castability";
import { beginResolution } from "./resolution";
import { advanceStep } from "./turn";

export function passPriority(state: GameState, player: PlayerId): ApplyResult {
    const priority = state.priority;
    if (!priority) return fail("Nobody has priority right now");
    if (priority.holder !== player) return fail("You don't have priority");

    const events: GameEvent[] = [{ type: "priorityPassed", player, step: state.turn.step }];
    const passes = priority.consecutivePasses + 1;

    if (passes < state.turnOrder.length) {
        const holder = nextPlayer(state, player);
        return grantPriority(state, events, holder, passes);
    }

    // Everyone passed in succession: resolve the top of the stack, or end the step.
    return state.stack.length > 0 ? resolveTopOfStack(state, events) : advanceStep(state, events);
}

export function givePriorityToActivePlayer(state: GameState, events: GameEvent[]): ApplyResult {
    return grantPriority(state, events, state.turn.activePlayer, 0);
}

export function stabilize(state: GameState, events: readonly GameEvent[], changesMade = false): { result: ApplyResult; changesMade: boolean } {
    const result = checkStateBasedActions(state, []);
    if (!result.ok) return { result, changesMade: false };
    if (result.changesMade) {
        return stabilize(result.state, [...events, ...result.events], true);
    }

    // Place triggers on the stack. If any triggers were placed, call stabilize again to check for state-based actions and new triggers.
    // If any triggers were placed, the priority holder is the active player. If no triggers were placed, the priority holder is the player who had priority before stabilization.

    return { result: ok(result.state, [...events, ...result.events]), changesMade };
}

export function grantPriority(state: GameState, events: readonly GameEvent[], holder: PlayerId, consecutivePasses: number): ApplyResult {
    const stabilized = stabilize(state, events);
    if (!stabilized.result.ok) return stabilized.result;
    return ok(withPriorityDecision({ ...stabilized.result.state, priority: { holder, consecutivePasses: stabilized.changesMade ? 0 : consecutivePasses } }), stabilized.result.events);
}

/**
 * Everything this player may legally do right now while holding priority.
 */
export function priorityOptions(state: GameState, player: PlayerId): readonly PriorityOption[] {
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
        ...getAllActivatableAbilities(state, player)
            .filter(({ source, abilityIndex }) => checkActivatable(state, player, source, abilityIndex).ok)
            .map(({ source, ability, abilityIndex }): PriorityOption => {
                const sourceName = getCardName(state, source);
                const cardText = describeAbility(ability, sourceName);
                return {
                    id: `activate:${source}:${abilityIndex}`,
                    label: `Activate ${sourceName}'s ability` + (cardText ? ` (${cardText})` : ""),
                    action: {
                        type: "activateAbility",
                        player,
                        source,
                        abilityIndex,
                    },
                };
            }),
    );

    options.push(
        ...getCastableSpells(state, player).map(
            (card): PriorityOption => ({
                id: `cast:${card}`,
                label: `Cast ${getCharacteristics(state, card)?.name}`,
                action: { type: "castSpell", player, card },
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

function getCastableSpells(state: GameState, player: PlayerId): ObjectId[] {
    const p = state.players[player];
    if (!p) return [];
    return p.hand.filter((card) => checkCastable(state, player, card).ok);
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

function resolveTopOfStack(state: GameState, events: readonly GameEvent[]): ApplyResult {
    const result = beginResolution(state);
    if (!result.ok) return result;
    return ok(result.state, [...events, ...result.events]);
}

export function playLand(state: GameState, player: PlayerId, card: ObjectId): ApplyResult {
    const priority = state.priority;
    if (!priority || priority.holder !== player) return fail("You don't have priority");

    const obj = state.objects[card];
    if (!obj || obj.owner !== player || obj.zone !== "hand") return fail("That card isn't in your hand");
    if (!getCharacteristics(state, card)?.types.includes("Land")) return fail("That card isn't a land");
    if (!canPlayLand(state, player)) return fail("You can't play a land right now");

    const moved = moveObject(state, card, "battlefield");
    if (!moved) return fail("That card is gone");

    const p = moved.state.players[player];
    if (!p) return fail("Unknown player");

    // Playing a land is a special action: it doesn't use the stack, and the player keeps priority.
    const next: GameState = {
        ...moved.state,
        players: withEntry(moved.state.players, player, { ...p, landsPlayedThisTurn: p.landsPlayedThisTurn + 1 }),
        priority: { holder: player, consecutivePasses: 0 },
    };
    const result = checkStateBasedActions(next, []);
    if (!result.ok) return result;
    return grantPriority(result.state, [...moved.events, ...result.events, { type: "landPlayed", player, card: moved.newId, cardName: getCardName(result.state, moved.newId) }], player, 0);
}