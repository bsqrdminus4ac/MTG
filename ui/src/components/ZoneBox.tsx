import { useRef, type MouseEvent, type ReactNode } from "react";

interface ZoneBoxProps {
  readonly title: string;
  readonly count: number;
  readonly defaultOpen?: boolean;
  /** Small muted text after the title, e.g. which end is the top. */
  readonly note?: string | undefined;
  readonly children: ReactNode;
}

/** A collapsible container for one zone, with buttons to expand or collapse every object inside it. */
export function ZoneBox({ title, count, defaultOpen = true, note, children }: ZoneBoxProps) {
  const ref = useRef<HTMLDetailsElement>(null);

  const setAll = (open: boolean) => (event: MouseEvent) => {
    event.preventDefault(); // the buttons live inside <summary>; don't also toggle the zone itself
    ref.current?.querySelectorAll<HTMLDetailsElement>("details.obj").forEach((d) => {
      d.open = open;
    });
  };

  return (
    <details className="zone" open={defaultOpen} ref={ref}>
      <summary>
        <span>{title}</span>
        <span className="count">{count}</span>
        {note !== undefined && <span className="note">{note}</span>}
        {count > 0 && (
          <span className="zone-actions">
            <button type="button" onClick={setAll(true)}>
              expand all
            </button>
            <button type="button" onClick={setAll(false)}>
              collapse all
            </button>
          </span>
        )}
      </summary>
      <div className="zone-body">{count === 0 ? <p className="empty">empty</p> : children}</div>
    </details>
  );
}
