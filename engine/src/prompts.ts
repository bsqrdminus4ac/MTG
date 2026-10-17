import { getCharacteristics } from "./characteristics";
import { priorityDecision, type PriorityOption } from "./decisions";
import type { Decision } from "./decisions";
import type { DecisionId, PlayerId } from "./ids";
import type { GameState } from "./state";

/** Stores a new pending decision, issuing it an id from the shared counter. */
export function openDecision(state: GameState, make: (id: DecisionId) => Decision): GameState {
  const id = state.nextId as DecisionId;
  return { ...state, nextId: state.nextId + 1, pending: make(id) };
}

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

/**
 * Everything this player may legally do right now while holding priority.
 * TODO: castSpell (needs mana payment) and activateAbility.
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

  options.push({ id: "pass", label: "Pass priority", action: { type: "passPriority", player } });
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
