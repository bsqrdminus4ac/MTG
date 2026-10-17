import { getCharacteristics, type GameState, type StackEntry } from "@mtg/engine";
import { describeAbility, describeEffect, describeTarget, nameOf } from "../describe";
import { Bullets, NestedList } from "./Bullets";

interface EntryProps {
  readonly state: GameState;
  readonly entry: StackEntry;
  readonly top: boolean;
}

function StackEntryCard({ state, entry, top }: EntryProps) {
  const name = nameOf(state, entry.source);
  const source = state.objects[entry.source];

  // A spell's effects live on its card; an ability on the stack carries its own copy.
  const effects =
    entry.kind === "ability"
      ? entry.effects.map(describeEffect)
      : (getCharacteristics(state, entry.source)?.abilities ?? []).filter((a) => a.kind === "spell").map(describeAbility);

  return (
    <details className="obj">
      <summary>
        {top && <span className="badge accent">top</span>}
        <span className="badge">{entry.kind}</span>
        <span className="name">{name}</span>
        <span className="note">by {entry.controller}</span>
      </summary>
      <Bullets
        items={[
          ["Stack ID", `#${entry.id}`],
          ["Kind", entry.kind],
          ["Controller", entry.controller],
          ["Source", `${name} (#${entry.source})`],
          ["Source zone", source?.zone ?? "missing"],
          ["Targets", <NestedList key="targets" items={entry.targets.map((t) => describeTarget(state, t))} />],
          ["Effects", <NestedList key="effects" items={effects} />],
        ]}
      />
    </details>
  );
}

/** The stack, with the entry that resolves next at the top. */
export function StackPanel({ state }: { readonly state: GameState }) {
  const entries = [...state.stack].reverse(); // the last element is the top of the stack
  return (
    <section className="panel" aria-label="Stack">
      <h2>
        Stack <span className="count">{entries.length}</span>
      </h2>
      {entries.length === 0 ? (
        <p className="empty">The stack is empty.</p>
      ) : (
        <ol className="stack-list">
          {entries.map((entry, i) => (
            <li key={entry.id}>
              <StackEntryCard state={state} entry={entry} top={i === 0} />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
