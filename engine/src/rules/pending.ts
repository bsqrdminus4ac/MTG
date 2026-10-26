import type { Decision } from "../model/decisions";
import type { DecisionId } from "../model/ids";
import type { GameState } from "../model/state";


/** Stores a new pending decision, issuing it an id from the shared counter. */
export function openDecision(
    state: GameState,
    make: (id: DecisionId) => Decision,
): GameState {
    const id = state.nextId as DecisionId;
    return { ...state, nextId: state.nextId + 1, pending: make(id) };
}