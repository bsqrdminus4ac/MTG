import { useCallback, useState } from "react";
import { submitAnswer, type Answer, type GameEvent, type GameState, type PlayerId, type Submission } from "@mtg/engine";
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
  readonly forcePass: Readonly<Partial<Record<PlayerId, number>>>;
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
    forcePass: {},
  };
}

/** Submits an answer to whatever the engine is currently asking, on behalf of the player being asked. */
function step(model: Model, answer: Answer): { readonly model: Model; readonly events: readonly GameEvent[] } {
  const d = model.state.pending;
  if (d === null) return { model: { ...model, error: "No decision is waiting" }, events: [] };
  const submission: Submission = { player: d.player, decision: d.id, answer };
  const result = submitAnswer(model.state, submission);
  if (!result.ok) {
    return {
      model: { ...model, error: result.error, log: appendLog(model.log, [{ kind: "error", text: result.error }]) },
      events: [],
    };
  }
  return {
    model: {
      state: result.state,
      error: null,
      log: appendLog(model.log, [
        { kind: "answer", text: `${d.player}: ${describeAnswer(d, answer)}` },
        ...result.events.map((e): Draft => ({ kind: "event", text: describeEvent(result.state, e) })),
      ]),
      history: { ...model.history, submissions: [...model.history.submissions, submission] },
      undoneDecisions: [],
      forcePass: model.forcePass,
    },
    events: result.events,
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
  return { ...model, state, log, forcePass: {}, history: { ...model.history, submissions: newSubmissions }, undoneDecisions: [...model.undoneDecisions, submissions[submissions.length - 1]!] };
}

function redo(model: Model): Model {
  if (model.undoneDecisions.length === 0) return model;
  const nextSubmission = model.undoneDecisions[model.undoneDecisions.length - 1]!;
  return {...step(model, nextSubmission.answer).model, undoneDecisions: model.undoneDecisions.slice(0, -1)};
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

    m = step(m, { kind: "priority", option: only.id }).model;
    if (m.error !== null || m.state.turn.number !== startTurn) break;
  }
  if (m.error !== null || m.state.turn.number !== startTurn || m.state.winner !== null) {
    return { ...m, forcePass: {} };
  }
  return m;
}

function endedForcePassPlayers(
  previousState: GameState,
  nextState: GameState,
  events: readonly GameEvent[],
  forcePass: Model["forcePass"],
): Model["forcePass"] {
  const previousStackIds = new Set(previousState.stack.map((entry) => entry.id));
  const addedEntries = nextState.stack.filter((entry) => !previousStackIds.has(entry.id));
  const attackers = events.filter((event) => event.type === "attackDeclared");
  const remaining: Partial<Record<PlayerId, number>> = {};
  for (const [player, turn] of Object.entries(forcePass) as [PlayerId, number][]) {
    const opponentAddedToStack = addedEntries.some((entry) => entry.controller !== player);
    const opponentAttacked = attackers.some((event) => event.player !== player);
    if (!opponentAddedToStack && !opponentAttacked) remaining[player] = turn;
  }
  return remaining;
}

/** Passes priority for each enabled player as they receive it, even if other actions are available. */
function runForcePass(model: Model): Model {
  let m = model;
  for (let i = 0; i < MAX_AUTO_PASSES; i++) {
    if (m.state.winner !== null) return { ...m, forcePass: {} };
    const current = m.state.pending;
    if (current !== null && current.kind === "priority") {
      const turn = m.forcePass[current.player];
      if (turn !== undefined && turn !== m.state.turn.number) {
        const { [current.player]: _, ...remaining } = m.forcePass;
        m = { ...m, forcePass: remaining };
        continue;
      }
    }
    const d = current;
    if (d === null || d.kind !== "priority" || m.forcePass[d.player] !== m.state.turn.number) break;
    const pass = d.options.find((option) => option.action.type === "passPriority");
    if (pass === undefined) break;

    const previousState = m.state;
    const result = step(m, { kind: "priority", option: pass.id });
    m = result.model;
    if (m.error !== null) return { ...m, forcePass: {} };
    const remaining = endedForcePassPlayers(previousState, m.state, result.events, m.forcePass);
    if (m.state.turn.number !== previousState.turn.number) {
      return { ...m, forcePass: {} };
    }
    const currentTurn: Partial<Record<PlayerId, number>> = {};
    for (const [player, turn] of Object.entries(remaining) as [PlayerId, number][]) {
      if (turn === m.state.turn.number) currentTurn[player] = turn;
    }
    m = { ...m, forcePass: currentTurn };
  }
  return m;
}

function submit(model: Model, answer: Answer): Model {
  const result = step(model, answer);
  if (result.model.error !== null) return { ...result.model, forcePass: {} };
  const forcePass = result.model.state.turn.number === model.state.turn.number
    ? endedForcePassPlayers(model.state, result.model.state, result.events, model.forcePass)
    : {};
  return runForcePass({ ...result.model, forcePass });
}

function toggleForcePass(model: Model, player: PlayerId): Model {
  if (model.forcePass[player] !== undefined) {
    const { [player]: _, ...remaining } = model.forcePass;
    return { ...model, forcePass: remaining };
  }
  if (model.error !== null || model.state.winner !== null) return model;
  return runForcePass({
    ...model,
    forcePass: { ...model.forcePass, [player]: model.state.turn.number },
  });
}

export function useGame() {
  const [model, setModel] = useState<Model>(freshModel);
  const submitAnswerAction = useCallback((answer: Answer) => setModel((m) => submit(m, answer)), []);
  const autoPass = useCallback(() => setModel((m) => runAutoPass(m)), []);
  const forcePassAction = useCallback((player: PlayerId) => setModel((m) => toggleForcePass(m, player)), []);
  const reset = useCallback(() => setModel(freshModel()), []);
  const undoAction = useCallback(() => setModel((m) => undo(m)), []);
  const redoAction = useCallback(() => setModel((m) => redo(m)), []);
  const enableUndo = model.history.submissions.length > 0;
  const enableRedo = model.undoneDecisions.length > 0;
  return { ...model, submit: submitAnswerAction, autoPass, toggleForcePass: forcePassAction, reset, undoAction, redoAction, enableUndo, enableRedo };
}
