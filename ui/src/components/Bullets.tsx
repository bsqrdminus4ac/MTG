import type { ReactNode } from "react";

export type BulletItem = readonly [label: string, value: ReactNode];

/** A bullet list of "label: value" rows. Labels must be unique within one list. */
export function Bullets({ items }: { readonly items: readonly BulletItem[] }) {
  return (
    <ul className="bullets">
      {items.map(([label, value]) => (
        <li key={label}>
          <span className="k">{label}</span>
          <span className="v">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A nested bullet list for values that are themselves lists. Renders `empty` when there are none. */
export function NestedList({ items, empty = "none" }: { readonly items: readonly string[]; readonly empty?: string }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ul className="nested">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
}
