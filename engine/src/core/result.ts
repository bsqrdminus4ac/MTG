import type { GameEvent } from "../model/events";
import type { GameState } from "../model/state";

export type Failure = Readonly<{ ok: false; error: string }>;

export type Result<T> = Readonly<{ ok: true; value: T }> | Failure;
export const goodResult = <T>(value: T): Result<T> => ({ ok: true, value });
export const badResult = (error: string): Result<never> => ({ ok: false, error });

export type ApplyResult = Readonly<{ ok: true; state: GameState; events: readonly GameEvent[]; changesMade?: boolean }> | Failure;

export const fail = (error: string): Failure => ({ ok: false, error });
export const ok = (state: GameState, events: readonly GameEvent[], changesMade?: boolean): ApplyResult =>
    changesMade === undefined ? { ok: true, state, events } : { ok: true, state, events, changesMade };



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