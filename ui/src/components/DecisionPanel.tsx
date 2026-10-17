import { useState } from "react";
import { validateAnswer, type Answer, type Decision, type GameState } from "@mtg/engine";
import { describeAction, describeChoiceValue } from "../describe";

interface Row {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
}

/** Every kind of decision boils down to a list of rows to pick from. */
function rowsFor(state: GameState, d: Decision): Row[] {
  switch (d.kind) {
    case "priority":
      return d.options.map((o) => ({ id: o.id, label: o.label, detail: describeAction(state, o.action) }));
    case "yesNo":
      return [
        { id: "yes", label: "Yes", detail: "" },
        { id: "no", label: "No", detail: "" },
      ];
    case "choose":
      return d.options.map((c) => ({ id: c.id, label: c.label, detail: describeChoiceValue(state, c.value) }));
  }
}

function buildAnswer(d: Decision, selected: readonly string[]): Answer | null {
  const first = selected[0];
  switch (d.kind) {
    case "priority":
      return first === undefined ? null : { kind: "priority", option: first };
    case "yesNo":
      return first === undefined ? null : { kind: "yesNo", value: first === "yes" };
    case "choose":
      return { kind: "choose", selected };
  }
}

interface FormProps {
  readonly state: GameState;
  readonly decision: Decision;
  readonly onSubmit: (answer: Answer) => void;
}

function DecisionForm({ state, decision, onSubmit }: FormProps) {
  const [selected, setSelected] = useState<readonly string[]>([]);

  const rows = rowsFor(state, decision);
  // "Pick exactly one" reads best as radio buttons; anything with a range is checkboxes.
  const single = decision.kind !== "choose" || (decision.min === 1 && decision.max === 1);

  const answer = buildAnswer(decision, selected);
  const check = answer === null ? null : validateAnswer(decision, answer);
  const ready = answer !== null && check !== null && check.ok;
  const hint = check === null ? "Select an option." : check.ok ? "Ready to submit." : check.error;

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (single ? [id] : on ? [...prev, id] : prev.filter((x) => x !== id)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (answer !== null && ready) onSubmit(answer);
      }}
    >
      <p className="decision-meta">
        <span className="badge hot">{decision.kind}</span>
        <span className="id">decision #{decision.id}</span>
      </p>
      <p className="who">{decision.player} must answer</p>

      <fieldset>
        <legend>{decision.prompt}</legend>
        <ul className="options">
          {rows.map((row) => {
            const on = selected.includes(row.id);
            return (
              <li key={row.id}>
                <label className={on ? "option on" : "option"}>
                  <input
                    type={single ? "radio" : "checkbox"}
                    name={`decision-${decision.id}`}
                    checked={on}
                    onChange={(e) => toggle(row.id, e.target.checked)}
                  />
                  <span className="opt-label">{row.label}</span>
                  {row.detail !== "" && <span className="opt-detail">{row.detail}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>

      <p className="hint">{hint}</p>
      <button type="submit" disabled={!ready}>
        Submit answer
      </button>

      <details className="raw-inline">
        <summary>Raw decision JSON</summary>
        <pre>{JSON.stringify(decision, null, 2)}</pre>
      </details>
    </form>
  );
}

interface PanelProps {
  readonly state: GameState;
  /** The engine's reason for rejecting the last answer, if it did. */
  readonly error: string | null;
  readonly onSubmit: (answer: Answer) => void;
}

/** Shows the question the engine is waiting on and lets you pick an answer for whoever is being asked. */
export function DecisionPanel({ state, error, onSubmit }: PanelProps) {
  const decision = state.pending;
  return (
    <section className="panel decision" aria-label="Decision">
      <h2>Decision</h2>
      {state.winner !== null ? (
        <p>Game over: {state.winner} wins.</p>
      ) : decision === null ? (
        <p className="empty">No decision is waiting.</p>
      ) : (
        // Keyed by decision id so a new question always starts with nothing selected.
        <DecisionForm key={decision.id} state={state} decision={decision} onSubmit={onSubmit} />
      )}
      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
