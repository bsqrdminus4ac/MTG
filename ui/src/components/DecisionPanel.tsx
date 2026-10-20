import { useState } from "react";
import {
    validateAnswer,
    type Answer,
    type Decision,
    type GameState,
} from "@mtg/engine";
import { describeAction, describeChoiceValue } from "../describe";

interface Row {
    readonly key: string;
    readonly optionId?: string;
    readonly label: string;
    readonly detail: string;
    readonly isCancel?: boolean;
}

/** Every kind of decision boils down to a list of rows to pick from. */
function rowsFor(state: GameState, d: Decision): Row[] {
    let rows: Row[];
    switch (d.kind) {
        case "priority":
            rows = d.options.map((o) => ({
                key: `option:${o.id}`,
                optionId: o.id,
                label: o.label,
                detail: describeAction(state, o.action),
            }));
            break;
        case "yesNo":
            rows = [
                {
                    key: "option:yes",
                    optionId: "yes",
                    label: "Yes",
                    detail: "",
                },
                { key: "option:no", optionId: "no", label: "No", detail: "" },
            ];
            break;
        case "choose":
            rows = d.options.map((c) => ({
                key: `option:${c.id}`,
                optionId: c.id,
                label: c.label,
                detail: describeChoiceValue(state, c.value),
            }));
            break;
    }
    return d.onCancel
        ? [
              ...rows,
              { key: "cancel", label: "Cancel", detail: "", isCancel: true },
          ]
        : rows;
}

function buildAnswer(
    d: Decision,
    rows: readonly Row[],
    selected: readonly string[],
): Answer | null {
    const selectedRows: Row[] = [];
    for (const key of selected) {
        const row = rows.find((candidate) => candidate.key === key);
        if (row === undefined) return null;
        selectedRows.push(row);
    }
    if (selectedRows.some((row) => row.isCancel)) {
        return selectedRows.length === 1 ? { kind: "cancel" } : null;
    }
    const optionIds = selectedRows.map((row) => row.optionId);
    if (optionIds.some((id) => id === undefined)) return null;
    const selectedOptionIds = optionIds.filter(
        (id): id is string => id !== undefined,
    );
    const first = selectedOptionIds[0];
    switch (d.kind) {
        case "priority":
            return first === undefined
                ? null
                : { kind: "priority", option: first };
        case "yesNo":
            return first === undefined
                ? null
                : { kind: "yesNo", value: first === "yes" };
        case "choose":
            return { kind: "choose", selected: selectedOptionIds };
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
    const single =
        decision.kind !== "choose" ||
        (decision.min === 1 && decision.max === 1);

    const answer = buildAnswer(decision, rows, selected);
    const check = answer === null ? null : validateAnswer(decision, answer);
    const ready = answer !== null && check !== null && check.ok;
    const hint =
        check === null
            ? "Select an option."
            : check.ok
              ? "Ready to submit."
              : check.error;

    const toggle = (row: Row, on: boolean) =>
        setSelected((prev) => {
            if (!on) return prev.filter((key) => key !== row.key);
            const cancelSelected = prev.some(
                (key) => rows.find((item) => item.key === key)?.isCancel,
            );
            return single || row.isCancel || cancelSelected
                ? [row.key]
                : [...prev, row.key];
        });

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
                        const on = selected.includes(row.key);
                        return (
                            <li key={row.key}>
                                <label className={on ? "option on" : "option"}>
                                    <input
                                        type={single ? "radio" : "checkbox"}
                                        name={`decision-${decision.id}`}
                                        checked={on}
                                        onChange={(e) =>
                                            toggle(row, e.target.checked)
                                        }
                                    />
                                    <span className="opt-label">
                                        {row.label}
                                    </span>
                                    {row.detail !== "" && (
                                        <span className="opt-detail">
                                            {row.detail}
                                        </span>
                                    )}
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
                <DecisionForm
                    key={decision.id}
                    state={state}
                    decision={decision}
                    onSubmit={onSubmit}
                />
            )}
            {error !== null && (
                <p className="error" role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}
