import { useCallback, useState } from "react";
import { submitAnswer, type Answer, type GameState, type Submission } from "@mtg/engine";
import { newDemoGame } from "./demo";
import { describeAnswer, describeEvent } from "./describe";

export interface LogEntry {
  readonly n: number;
  readonly kind: "answer" | "event" | "error";
  readonly text: string;
}

interface History {
  readonly startingState: GameState;
  readonly submissions: Submission[];
}

interface Model {
  readonly state: GameState;
  readonly log: readonly LogEntry[];
  /** The engine's reason for rejecting the last answer, if it did. */
  readonly error: string | null;
  readonly history: History;
  readonly undoneDecisions: readonly Submission[];
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
  const startingState = newDemoGame();
  return {
    state: startingState,
    log: appendLog([], [{ kind: "event", text: "New game: alice vs bob, 7 cards each (decks are not shuffled)" }]),
    error: null,
    history: { startingState, submissions: [] },
    undoneDecisions: [],
  };
}

/** Submits an answer to whatever the engine is currently asking, on behalf of the player being asked. */
function step(model: Model, answer: Answer): Model {
  const d = model.state.pending;
  if (d === null) return { ...model, error: "No decision is waiting" };
  const submission: Submission = { player: d.player, decision: d.id, answer };
  const result = submitAnswer(model.state, submission);
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
    history: { ...model.history, submissions: [...model.history.submissions, submission] },
    undoneDecisions: [],
  };
}

function undo(model: Model): Model {
  const { startingState, submissions } = model.history;
  if (submissions.length === 0) return model;
  const newSubmissions = submissions.slice(0, -1);
  let state = startingState;
  let log: readonly LogEntry[] = appendLog([], [{ kind: "event", text: "New game: alice vs bob, 7 cards each (decks are not shuffled)" }]);
  for (const submission of newSubmissions) {
    const result = submitAnswer(state, submission);
    if (!result.ok) throw new Error("Failed to replay history: " + result.error);
    state = result.state;
    log = appendLog(log, [{ kind: "answer", text: `${submission.player}: ${describeAnswer(state.pending!, submission.answer)}`}, ...result.events.map((e): Draft => ({ kind: "event", text: describeEvent(result.state, e) }))]); 
  } 
  return { ...model, state, log, history: { ...model.history, submissions: newSubmissions }, undoneDecisions: [...model.undoneDecisions, submissions[submissions.length - 1]!] };
}

function redo(model: Model): Model {
  if (model.undoneDecisions.length === 0) return model;
  const nextSubmission = model.undoneDecisions[model.undoneDecisions.length - 1]!;
  return {...step(model, nextSubmission.answer), undoneDecisions: model.undoneDecisions.slice(0, -1)};
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
  const undoAction = useCallback(() => setModel((m) => undo(m)), []);
  const redoAction = useCallback(() => setModel((m) => redo(m)), []);
  const enableUndo = model.history.submissions.length > 0;
  const enableRedo = model.undoneDecisions.length > 0;
  return { ...model, submit, autoPass, reset, undoAction, redoAction, enableUndo, enableRedo };
}
