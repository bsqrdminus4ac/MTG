import type { LogEntry } from "../useGame";

/** Everything that has happened, newest first. */
export function EventLog({ log }: { readonly log: readonly LogEntry[] }) {
  const newestFirst = [...log].reverse();
  return (
    <section className="panel" aria-label="Log">
      <h2>Log</h2>
      <ol className="log">
        {newestFirst.map((entry) => (
          <li key={entry.n} className={`log-${entry.kind}`}>
            <span className="n">{entry.n}</span>
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
