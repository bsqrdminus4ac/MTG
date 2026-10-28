import { type ApplyResult, fail, ok } from "../core/result";
import { withEntry } from "../core/util";
import { getCardName, getCharacteristics } from "../model/characteristics";
import { type PriorityOption, priorityDecision } from "../model/decisions";
import type { GameEvent } from "../model/events";
import type { ObjectId, PlayerId } from "../model/ids";
import { type GameState, nextPlayer } from "../model/state";
import { moveObject } from "../model/zones";
import { openDecision } from "../rules/pending";
import { checkStateBasedActions } from "../rules/stateBasedActions";
import { canPlayLand } from "../rules/timing";
import { getCardText } from "../model/effects";
import { getAllActivatableAbilities } from "./abilities";
import { couldHaveManaToPayCost } from "./manaAbilities";
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
    const result = checkStateBasedActions(state, events);
    if (!result.ok) return result;
    return ok(withPriorityDecision({ ...result.state, priority: { holder, consecutivePasses: passes } }), result.events);
  }

  // Everyone passed in succession: resolve the top of the stack, or end the step.
  return state.stack.length > 0 ? resolveTopOfStack(state, events) : advanceStep(state, events);
}

export function givePriorityToActivePlayer(state: GameState, events: GameEvent[]): ApplyResult {
    const result = checkStateBasedActions(state, []);
    if (!result.ok) return result;
    return ok(
        withPriorityDecision({
            ...result.state,
            priority: { holder: state.turn.activePlayer, consecutivePasses: 0 },
        }),
        [...events, ...result.events],
    );
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
        ...getAllActivatableAbilities(state, player).map(({ source, ability, abilityIndex }): PriorityOption => {
            const cardText = getCardText(ability.effects)[0];
            return {
                id: `activate:${source}:${abilityIndex}`,
                label:
                    `Activate ${getCharacteristics(state, source)?.name}'s ability` +
                    (cardText ? ` (${cardText})` : ""),
                action: {
                    type: "activateAbility",
                    player,
                    source,
                    abilityIndex,
                }, // TODO: handle targets
            };
        }),
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
  const result = checkStateBasedActions(state, []);
  if (!result.ok) return result;
  return ok(withPriorityDecision(next), [...moved.events, ...result.events, { type: "landPlayed", player, card: moved.newId, cardName: getCardName(result.state, moved.newId) }]);
}