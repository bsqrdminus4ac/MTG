import { useMemo, useState } from "react";
import { PHASE_OF, STEPS, type GameState } from "@mtg/engine";
import { DecisionPanel } from "./components/DecisionPanel";
import { EventLog } from "./components/EventLog";
import { PlayerPanel } from "./components/PlayerPanel";
import { StackPanel } from "./components/StackPanel";
import { findProblems } from "./describe";
import { useGame } from "./useGame";

function stringifyForDisplay(value: object): string {
  return JSON.stringify(value, (key, nestedValue) => (key === "rollback" ? "[...]" : nestedValue), 2);
}

/** The whole state as JSON. Only built while open, since it includes every card definition. */
function RawState({ state }: { readonly state: GameState }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Raw game state (JSON)</summary>
      {open && <pre>{stringifyForDisplay(state)}</pre>}
    </details>
  );
}

export function ProgressState({ title, value }: { readonly title: string; readonly value: object }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{title}</summary>
      {open && <pre>{stringifyForDisplay(value)}</pre>}
    </details>
  );
}

export function App() {
  const game = useGame();
  const { state } = game;
  const problems = useMemo(() => findProblems(state), [state]);
  const { turn } = state;

  return (
    <div className="app">
      <header className="topbar">
        <h1>MTG engine debugger</h1>
        <div className="turn">
          <span>
            Turn <b>{turn.number}</b>
          </span>
          <span>
            Active: <b>{turn.activePlayer}</b>
          </span>
          <span>
            Phase: <b>{PHASE_OF[turn.step]}</b>
          </span>
          <span>
            Priority: <b>{state.priority?.holder ?? "nobody"}</b>
          </span>
          {problems.length === 0 && <span className="badge ok">state consistent</span>}
        </div>
        <div className="actions">
          <button type="button" onClick={game.undoAction} title="Undo the last decision." disabled={!game.enableUndo}>
            Undo
          </button>
          <button type="button" onClick={game.redoAction} title="Redo the last undone decision." disabled={!game.enableRedo}>
            Redo
          </button>
          <button
            type="button"
            onClick={game.autoPass}
            title="Keep passing priority while passing is the only option. Stops at a real choice or at the next turn."
          >
            Auto-pass
          </button>
          <button type="button" onClick={game.reset}>
            New game
          </button>
        </div>
        <ol className="steps" aria-label="Turn steps">
          {STEPS.map((s) => (
            <li key={s} className={s === turn.step ? "on" : ""} aria-current={s === turn.step ? "step" : undefined}>
              {s}
            </li>
          ))}
        </ol>
      </header>

      {problems.length > 0 && (
        <div className="banner bad" role="alert">
          <strong>State check failed:</strong>
          <ul>
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      <main className="layout">
        <div className="players">
          {state.turnOrder.map((id, seat) => {
            const player = state.players[id];
            return player ? (
              <PlayerPanel
                key={id}
                state={state}
                player={player}
                seat={seat}
                forcePassEnabled={game.forcePass[id] !== undefined}
                forcePassAvailable={game.error === null && state.winner === null && game.forcePass[id] === undefined}
                onToggleForcePass={game.toggleForcePass}
              />
            ) : null;
          })}
        </div>
        <aside className="side">
          <DecisionPanel state={state} error={game.error} onSubmit={game.submit} />
          <StackPanel state={state} />
          <EventLog log={game.log} />
        </aside>
        <aside className="progress-side" aria-label="In-progress state">
          {state.casting !== null && <ProgressState title="Casting" value={state.casting} />}
          {state.combat !== null && <ProgressState title="Combat" value={state.combat} />}
          {state.resolving !== null && <ProgressState title="Resolving" value={state.resolving} />}
          <RawState state={state} />
        </aside>
      </main>
    </div>
  );
}
