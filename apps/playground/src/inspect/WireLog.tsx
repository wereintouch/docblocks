import { useEffect, useRef } from "react";

/** One logged wire event: direction and size, stamped since the pane's runtime mount. */
interface WireEvent {
  /** Unique per pane (the log stays capped, so the id is the stable key). */
  id: number;
  /** Milliseconds since the pane's runtime mount. */
  at: number;
  dir: "out" | "in";
  bytes: number;
}

/**
 * The pane's wire event log: the last `WIRE_CAP` document updates the pane's
 * provider sent (`out`, observed by the pane wrapping the instance-level
 * `sendUpdate`) or received (`in`, via `onUpdate`). Lines read
 * `[t+<ms>ms] out <n>B` / `in <n>B`, newest at the bottom; the list
 * auto-scrolls so the tail stays visible.
 */
function WireLog({ client, events }: { client: "a" | "b"; events: WireEvent[] }) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list !== null) list.scrollTop = list.scrollHeight;
  }, [events]);

  return (
    <div data-testid={`wire-${client}`} style={{ border: "1px solid var(--border)", marginTop: 8 }}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", fontSize: 12 }}>
        wire — {events.length} events
      </div>
      <ul
        ref={listRef}
        style={{
          listStyle: "none",
          margin: 0,
          padding: 8,
          overflow: "auto",
          maxHeight: 220,
          fontFamily: "monospace",
          fontSize: 11,
        }}
      >
        {events.map((event) => (
          <li key={event.id}>
            [t+{event.at}ms] {event.dir} {event.bytes}B
          </li>
        ))}
      </ul>
    </div>
  );
}

export { WireLog };
export type { WireEvent };
