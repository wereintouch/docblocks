import { Button, cn } from "docblocks-react-ui";

import { useEffect, useState } from "react";

/**
 * The shared chaos bar: drives the relay's per-room frame chaos for the
 * `?syncUrl=` room (the frame-delivery layer — frames are dropped or
 * delayed, the sockets stay up, the bar does not reconnect anything).
 * Both panes point at the same room, so either tab controls it. The active
 * mode shows on the pressed button and in the `chaos-state` span, from the
 * relay's response.
 */

/** The relay's chaos modes in display order (the mode value is the HTTP body value). */
const MODES: { mode: "none" | "drop50" | "delay500"; label: string; testid: string }[] = [
  { mode: "none", label: "none", testid: "chaos-none" },
  { mode: "drop50", label: "drop 50%", testid: "chaos-drop" },
  { mode: "delay500", label: "delay 500ms", testid: "chaos-delay" },
];

/** A room's chaos config as returned by the relay's /__chaos endpoint. */
interface ChaosState {
  mode: "none" | "drop" | "delay";
  dropRate: number;
  delayMs: number;
}

/** The relay's /__chaos endpoint: the ws url's http twin on the same port. */
function chaosEndpoint(syncUrl: string): string {
  const url = new URL(syncUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = "/__chaos";
  url.search = "";
  return url.toString();
}

/** The bar's label for a chaos state (the active mode's parameters, from the relay). */
function labelOf(state: ChaosState): string {
  if (state.mode === "drop") return `drop ${Math.round(state.dropRate * 100)}%`;
  if (state.mode === "delay") return `delay ${state.delayMs}ms`;
  return "none";
}

function ChaosBar({ syncUrl }: { syncUrl: string }) {
  const [state, setState] = useState<ChaosState | null>(null);
  const endpoint = chaosEndpoint(syncUrl);
  const room = new URL(syncUrl).pathname;

  // The room exists once the pane's socket connects; an early 404 just
  // leaves the bar in the unknown state until a mode is applied.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${endpoint}?room=${encodeURIComponent(room)}`);
        const value = response.ok ? ((await response.json()) as ChaosState) : null;
        if (!cancelled && value !== null) setState(value);
      } catch {
        // the early 404 / the refused fetch leaves the bar in the unknown state
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, room]);

  const onMode = (mode: "none" | "drop50" | "delay500") => {
    void (async () => {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room, mode }),
        });
        const value = response.ok ? ((await response.json()) as ChaosState) : null;
        if (value !== null) setState(value);
      } catch {
        // the refused fetch stands the last known mode
      }
    })();
  };

  const activeLabel = state === null ? "unknown" : labelOf(state);

  return (
    <div
      data-testid="chaosbar"
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span className="text-xs">chaos:</span>
      {MODES.map(({ mode, label, testid }) => {
        const active = state !== null && labelOf(state) === label;
        const modeAt = (mode: Parameters<typeof onMode>[0]) => () => onMode(mode);
        return (
          <Button
            key={mode}
            type="button"
            variant="outline"
            size="sm"
            data-testid={testid}
            aria-pressed={active}
            className={cn(
              "h-auto gap-0 rounded px-2 py-0.5 text-xs font-normal shadow-none",
              active ? "bg-accent" : "bg-muted"
            )}
            onClick={modeAt(mode)}
          >
            {label}
          </Button>
        );
      })}
      <span data-testid="chaos-state" style={{ fontFamily: "monospace", fontSize: 12 }}>
        {activeLabel}
      </span>
    </div>
  );
}

export { ChaosBar };
