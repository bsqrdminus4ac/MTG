import { useCallback, useState } from "react";
import { submitAnswer, type Answer, type GameState } from "@mtg/engine";
import { newDemoGame } from "./demo";
import { describeAnswer, describeEvent } from "./describe";

export interface LogEntry {
  readonly n: number;
  readonly kind: "answer" | "event" | "error";
  readonly text: string;
}

interface Model {
  readonly state: GameState;
  readonly log: readonly LogEntry[];
  /** The engine's reason for rejecting the last answer, if it did. */
  readonly error: string | null;
}

const MAX_LOG = 300;
const MAX_AUTO_PASSES = 500;

type Draft = Omit<LogEntry, "n">;

function appendLog(log: readonly LogEntry[], drafts: readonly Draft[]): readonly LogEntry[] {
  const last = log[log.length - 1]?.n ?? 0;
  const added = drafts.map((d, i): LogEntry => ({ n: last + i + 1, ...d }));
  return [...log, ...added].slice(-MAX_LOG);
}

function freshModel(): Model {
  return {
    state: newDemoGame(),
    log: appendLog([], [{ kind: "event", text: "New game: alice vs bob, 7 cards each (decks are not shuffled)" }]),
    error: null,
  };
}

/** Submits an answer to whatever the engine is currently asking, on behalf of the player being asked. */
function step(model: Model, answer: Answer): Model {
  const d = model.state.pending;
  if (d === null) return { ...model, error: "No decision is waiting" };

  const result = submitAnswer(model.state, { player: d.player, decision: d.id, answer });
  if (!result.ok) {
    return { ...model, error: result.error, log: appendLog(model.log, [{ kind: "error", text: result.error }]) };
  }
  return {
    state: result.state,
    error: null,
    log: appendLog(model.log, [
      { kind: "answer", text: `${d.player}: ${describeAnswer(d, answer)}` },
      ...result.events.map((e): Draft => ({ kind: "event", text: describeEvent(result.state, e) })),
    ]),
  };
}

/**
 * Keeps passing priority while "pass" is the only legal option, and stops as soon as there is a
 * real choice, a different kind of decision, an error, or a new turn begins.
 */
function runAutoPass(model: Model): Model {
  const startTurn = model.state.turn.number;
  let m = model;
  for (let i = 0; i < MAX_AUTO_PASSES; i++) {
    const d = m.state.pending;
    if (m.state.winner !== null || d === null || d.kind !== "priority") break;
    const only = d.options.length === 1 ? d.options[0] : undefined;
    if (only === undefined || only.action.type !== "passPriority") break;

    m = step(m, { kind: "priority", option: only.id });
    if (m.error !== null || m.state.turn.number !== startTurn) break;
  }
  return m;
}

export function useGame() {
  const [model, setModel] = useState<Model>(freshModel);
  const submit = useCallback((answer: Answer) => setModel((m) => step(m, answer)), []);
  const autoPass = useCallback(() => setModel((m) => runAutoPass(m)), []);
  const reset = useCallback(() => setModel(freshModel()), []);
  return { ...model, submit, autoPass, reset };
}
