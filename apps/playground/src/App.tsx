import { DsPanel } from "./DsPanel";
import { SyncPane } from "./SyncPane";
import { TablesSection } from "./TablesSection";
import { parseLongdocCount } from "./longdoc-seed";

/** The in-process dev relay (see vite.config.ts). */
const DEFAULT_SYNC_URL = "ws://localhost:5199/doc-1";

/** The canvas demo keeps its own room (the deterministic canvas seed must not mix with the default doc-1 room's content). */
const CANVAS_SYNC_URL = "ws://localhost:5199/canvas-demo";

/** The heavy canvas's room (the synthetic grid's stand — the room's isolation stands the relay's own room per demo). */
const HEAVY_SYNC_URL = "ws://localhost:5199/heavy-demo";

/** The long document's room (the windowing baseline's stand — the default
 *  room's starter paragraph must not mix with the seed). */
const LONGDOC_SYNC_URL = "ws://localhost:5199/longdoc-demo";

/**
 * Playground page: one sync pane per tab. `?client=a|b` picks the pane's
 * letter (default a); `?syncUrl=` overrides the relay URL (the E2E smoke
 * spec points it at a real y-websocket server); the doc area always
 * renders the base `Editor` (the motion page view is the Editor's
 * default); `?catalog=1` builds the deterministic v1 catalog document (the visual regression fixture, see catalog.ts) instead of the
 * empty seed; `?canvas=1` seeds the canvas demo (the page + a surface with
 * shapes, a canvas text, and a connector — see canvas-seed.ts) and starts
 * in the canvas view; `?heavy=1` seeds the heavy canvas (the synthetic
 * grid — the 5000 figures + the 1500 connectors, heavy-seed.ts) over its
 * own room and starts in the canvas view; `?longdoc=1` (`?longdoc=<n>`)
 * seeds the long page — 200 (`n`) image blocks over their own room
 * (longdoc-seed.ts, the windowing baseline's stand); `?role=viewer` stands
 * the pane's viewer's access
 * level (the security stand — the pane holds no live document and no
 * relay: the pane renders the room's published snapshot stand read-only,
 * the publish.ts's stand; the absent stand stands the not-published's
 * placeholder; `?cycle=1` seeds the pane's master doc with a sync-embed
 * referencing the outer doc (the cycle-guard e2e case); `?ds=1` renders the
 * design system preview instead of a pane (DsPanel.tsx — the shared/ui
 * primitives outside any editor root, the visual gate for the compiled
 * utility CSS, no relay/doc involved); `?tables=1` renders the
 * standalone's database tables section instead of a pane
 * (TablesSection.tsx — the `useTableList` + the `DatabaseTable` over the
 * harness's shared bridge, no relay/doc involved); `?attrDemo=1` wires
 * the consumer's attributes customization over the editor provider (the
 * `renderAttribute`'s status-badge + the `createdBy`'s catalog resolution
 * + the `attributeTypePicker`'s segmented type picker — attribute-demos.tsx
 * — the built-in's stands stand over the flag's absence). Each pane renders
 * the two-pane layout: the editor (page or canvas) on the left and the
 * system panel (status, the relay's per-room chaos controls, the live
 * JSON / wire / presence inspectors) on the right.
 */
function App() {
  const params = new URLSearchParams(window.location.search);
  const client = params.get("client") === "b" ? "b" : "a";
  const canvas = params.get("canvas") === "1";
  const heavy = params.get("heavy") === "1";
  const longdocParam = params.get("longdoc");
  // The longdoc seed is opt-in: an absent flag or `?longdoc=0` keeps the
  // pane's default seed (the starter paragraph's stand); the bare flag or
  // a malformed value seeds the default count (200) over its own room.
  const longdocCount = longdocParam === null || longdocParam === "0" ? 0 : parseLongdocCount(longdocParam);
  const role = params.get("role") === "viewer" ? "viewer" : "editor";
  const syncUrl =
    params.get("syncUrl") ??
    (heavy ? HEAVY_SYNC_URL : longdocCount > 0 ? LONGDOC_SYNC_URL : canvas ? CANVAS_SYNC_URL : DEFAULT_SYNC_URL);
  const catalog = params.get("catalog") === "1";
  const blobEager = params.get("blobEager") === "1";
  const cycle = params.get("cycle") === "1";
  const ds = params.get("ds") === "1";
  const tables = params.get("tables") === "1";
  const attrDemo = params.get("attrDemo") === "1";
  if (tables) return <TablesSection />;
  if (ds) return <DsPanel />;
  return (
    <SyncPane
      client={client}
      syncUrl={syncUrl}
      catalog={catalog}
      canvas={canvas}
      heavy={heavy}
      longdoc={longdocCount}
      cycle={cycle}
      role={role}
      attrDemo={attrDemo}
      blobEager={blobEager}
    />
  );
}

export { App };
