import { getCharacteristics, type GameState, type StackEntry } from "@mtg/engine";
import { describeAbility, describeCardText, describeTarget, nameOf } from "../describe";
import { Bullets, NestedList, type BulletItem } from "./Bullets";

interface EntryProps {
  readonly state: GameState;
  readonly entry: StackEntry;
  readonly top: boolean;
}

function StackEntryCard({ state, entry, top }: EntryProps) {
  const name = nameOf(state, entry.source);
  const source = state.objects[entry.source];

  // A spell's effects live on its card; an ability on the stack carries its own copy.
  const abilities = entry.kind === "ability" ? [entry.ability] : (getCharacteristics(state, entry.source)?.abilities ?? []).filter((a) => a.kind === "spell");
  const effects = abilities.map(describeAbility);
  const cardText = abilities.flatMap((ability) => describeCardText(ability, name));
  const abilityText = cardText.join("; ");
  const items: BulletItem[] = [
      ["Stack ID", `#${entry.id}`],
      ["Kind", entry.kind],
      ["Controller", entry.controller],
      ["Source", `${name} (#${entry.source})`],
      ["Source zone", source?.zone ?? "missing"],
      ["Targets", <NestedList key="targets" items={entry.targets.flatMap((spec) => spec.map((t) => describeTarget(state, t)))} />],
      ["Effects", <NestedList key="effects" items={effects} />],
  ];
  if (cardText.length > 0) {
    items.push(["Card Text", <NestedList key="card-text" items={cardText} />]);
  }

  return (
    <details className="obj">
      <summary>
        {top && <span className="badge accent">top</span>}
        <span className="badge">{entry.kind}</span>
        <span className="stack-summary-main">
          <span className="stack-title">
            <span className="name">{name}</span>
            <span className="note">by {entry.controller}</span>
          </span>
          {abilityText && <span className="stack-ability-text">{abilityText}</span>}
        </span>
      </summary>
      <Bullets items={items} />
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
