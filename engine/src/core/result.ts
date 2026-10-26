import type { GameEvent } from "../model/events";
import type { GameState } from "../model/state";

export type ApplyResult = Readonly<{ ok: true; state: GameState; events: readonly GameEvent[]; changesMade?: boolean }> | Readonly<{ ok: false; error: string }>;

export const ok = (state: GameState, events: readonly GameEvent[], changesMade?: boolean): ApplyResult =>
    changesMade === undefined ? { ok: true, state, events } : { ok: true, state, events, changesMade };
export const fail = (error: string): ApplyResult => ({ ok: false, error });

export function applySequentially(state: GameState, steps: readonly ((state: GameState) => ApplyResult)[]): ApplyResult {
    let currentState = state;
    const events: GameEvent[] = [];
    let changesMade = false;
    for (const step of steps) {
        const result = step(currentState);
        if (!result.ok) return result;
        currentState = result.state;
        events.push(...result.events);
        if (result.changesMade) changesMade = true;
        if (currentState.winner) break; // Stop processing if a winner has been determined
    }
    return ok(currentState, events, changesMade);
}