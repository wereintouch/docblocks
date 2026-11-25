import { Button, cn } from "docblocks-react-ui";

import type { PresenceState } from "docblocks-core";

import { ChaosBar } from "./ChaosBar";
import { BridgeInspector } from "./inspect/BridgeInspector";
import { JsonInspector } from "./inspect/JsonInspector";
import { PresencePanel } from "./inspect/PresencePanel";
import { type WireEvent, WireLog } from "./inspect/WireLog";
import type { Runtime } from "./use-sync-runtime";

/** The inspector tabs in the pane's system panel. */
const TABS = ["json", "wire", "presence", "bridge"] as const;
type InspectTab = (typeof TABS)[number];

const TOGGLE_BTN = "h-auto gap-0 rounded-md px-2.5 py-0.5 text-[13px] font-normal shadow-none";
const TAB_BTN = "h-auto gap-0 rounded px-2 py-0.5 text-xs font-normal shadow-none";

/**
 * The pane's system panel (the right-hand column): the harness' theme and
 * cover-preset toggles, the connection's status + the relay's per-room
 * chaos controls, and the live inspectors (JSON / Wire / Presence /
 * Bridge tabs): all four stay mounted, the tabs only toggle visibility —
 * the subscriptions live in the runtime hook, so a hidden inspector keeps
 * updating and its testid stays queryable.
 */
function PaneSystemPanel({
  client,
  role,
  syncUrl,
  connected,
  onReconnect,
  dark,
  onDarkChange,
  coverPresetsOn,
  onCoverPresetsChange,
  runtime,
  wire,
  presence,
  tab,
  onTabChange,
  peerLetter,
}: {
  client: "a" | "b";
  role: "editor" | "viewer";
  syncUrl: string;
  connected: boolean;
  onReconnect: () => void;
  dark: boolean;
  onDarkChange: (dark: boolean) => void;
  coverPresetsOn: boolean;
  onCoverPresetsChange: (on: boolean) => void;
  runtime: Runtime | null;
  wire: WireEvent[];
  presence: PresenceState[];
  tab: InspectTab;
  onTabChange: (tab: InspectTab) => void;
  peerLetter: "a" | "b";
}) {
  return (
    <aside className="doc-aside">
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
        theme
        <Button
          type="button"
          variant={dark ? "default" : "outline"}
          size="sm"
          data-testid={`theme-${client}-dark`}
          aria-pressed={dark}
          className={TOGGLE_BTN}
          onClick={() => onDarkChange(true)}
        >
          dark
        </Button>
        <Button
          type="button"
          variant={!dark ? "default" : "outline"}
          size="sm"
          data-testid={`theme-${client}-light`}
          aria-pressed={!dark}
          className={TOGGLE_BTN}
          onClick={() => onDarkChange(false)}
        >
          light
        </Button>
      </div>
      {/* The cover preset's gallery's toggle (the consumer's `coverPresets`
          prop's stand: on = the harness's fixed id's gallery, off = the
          no-preset's layout's stand). */}
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
        cover presets
        <Button
          type="button"
          variant={coverPresetsOn ? "default" : "outline"}
          size="sm"
          data-testid={`coverpresets-${client}-on`}
          aria-pressed={coverPresetsOn}
          className={TOGGLE_BTN}
          onClick={() => onCoverPresetsChange(true)}
        >
          on
        </Button>
        <Button
          type="button"
          variant={!coverPresetsOn ? "default" : "outline"}
          size="sm"
          data-testid={`coverpresets-${client}-off`}
          aria-pressed={!coverPresetsOn}
          className={TOGGLE_BTN}
          onClick={() => onCoverPresetsChange(false)}
        >
          off
        </Button>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
        <span data-testid={`status-${client}`}>{connected ? "connected" : "disconnected"}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid={`reconnect-${client}`}
          className="h-auto gap-0 px-2.5 py-0.5 text-[13px] font-normal"
          onClick={onReconnect}
        >
          reconnect
        </Button>
      </div>
      {role !== "viewer" && <ChaosBar syncUrl={syncUrl} />}
      {runtime !== null && (
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {TABS.map((name) => (
              <Button
                key={name}
                type="button"
                variant="outline"
                size="sm"
                data-testid={`inspecttab-${client}-${name}`}
                aria-pressed={tab === name}
                className={cn(TAB_BTN, tab === name ? "bg-accent" : "bg-muted")}
                onClick={() => onTabChange(name)}
              >
                {name}
              </Button>
            ))}
          </div>
          <div style={{ overflowY: "auto", maxHeight: "60vh", marginTop: 8 }}>
            <div style={{ display: tab === "json" ? undefined : "none" }}>
              <JsonInspector client={client} doc={runtime.doc} />
            </div>
            <div style={{ display: tab === "wire" ? undefined : "none" }}>
              <WireLog client={client} events={wire} />
            </div>
            <div style={{ display: tab === "presence" ? undefined : "none" }}>
              <PresencePanel client={client} peerLabel={peerLetter} mountAt={runtime.mountedAt} peers={presence} />
            </div>
            <div style={{ display: tab === "bridge" ? undefined : "none" }}>
              <BridgeInspector client={client} />
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export { PaneSystemPanel, TOGGLE_BTN };
export type { InspectTab };
