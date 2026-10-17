import { getCharacteristics, manaValue, type GameState, type ObjectId } from "@mtg/engine";
import { describeAbility, describeContinuousEffect, describeManaCost } from "../describe";
import { Bullets, NestedList, type BulletItem } from "./Bullets";

interface ObjectCardProps {
  readonly state: GameState;
  readonly id: ObjectId;
  /** Extra badge in the summary line, e.g. "top". */
  readonly tag?: string | undefined;
}

const orDash = (words: readonly string[]): string => (words.length > 0 ? words.join(" ") : "—");

/** One game object as a collapsible element: a summary line, and its properties as bullets when opened. */
export function ObjectCard({ state, id, tag }: ObjectCardProps) {
  const obj = state.objects[id];
  if (!obj) {
    return (
      <div className="obj missing" role="alert">
        Missing object #{id}: a zone lists it, but state.objects does not
      </div>
    );
  }

  const chars = getCharacteristics(state, id);
  const counters = Object.entries(obj.counters);
  const isCreature = chars?.types.includes("Creature") ?? false;
  const effects = state.continuousEffects.filter((e) =>
    e.affects.kind === "object" ? e.affects.id === id : obj.zone === "battlefield" && isCreature,
  );

  const items: BulletItem[] = [
    ["Object ID", `#${id}`],
    ["Definition", obj.definitionId],
    ["Owner", obj.owner],
    ["Controller", obj.controller],
    ["Zone", obj.zone],
    ["Timestamp", String(obj.timestamp)],
    ["Tapped", obj.tapped ? "yes" : "no"],
    ["Damage", String(obj.damage)],
    ["Counters", counters.length > 0 ? counters.map(([kind, n]) => `${kind} ×${n}`).join(", ") : "none"],
  ];

  if (chars) {
    const subtypes = chars.subtypes.length > 0 ? ` — ${chars.subtypes.join(" ")}` : "";
    items.push(
      ["Type line", orDash([...chars.supertypes, ...chars.types]) + subtypes],
      ["Colors", chars.colors.length > 0 ? chars.colors.join("") : "colorless"],
      ["Mana cost", describeManaCost(chars.manaCost)],
      ["Mana value", String(manaValue(chars.manaCost))],
      ["Power / toughness", chars.power !== null && chars.toughness !== null ? `${chars.power}/${chars.toughness}` : "—"],
      ["Abilities", <NestedList key="abilities" items={chars.abilities.map(describeAbility)} />],
      ["Active effects", <NestedList key="effects" items={effects.map((e) => describeContinuousEffect(state, e))} />],
    );
  } else {
    items.push(["Characteristics", "definition not found in state.definitions"]);
  }

  return (
    <details className="obj">
      <summary>
        <span className="name">{chars?.name ?? "Unknown card"}</span>
        <span className="id">#{id}</span>
        {tag !== undefined && <span className="badge accent">{tag}</span>}
        {chars?.power != null && chars.toughness != null && (
          <span className="badge">
            {chars.power}/{chars.toughness}
          </span>
        )}
        {obj.tapped && <span className="badge warn">tapped</span>}
        {obj.damage > 0 && <span className="badge warn">{obj.damage} damage</span>}
        {counters.length > 0 && <span className="badge">counters</span>}
        {obj.controller !== obj.owner && <span className="badge warn">controlled by {obj.controller}</span>}
      </summary>
      <Bullets items={items} />
    </details>
  );
}
