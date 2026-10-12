import { ChaosBar } from "./ChaosBar";
import { SyncPane } from "./SyncPane";

/** The in-process dev relay (see vite.config.ts). */
const DEFAULT_SYNC_URL = "ws://localhost:5199/doc-1";

/** The canvas demo keeps its own room (the deterministic canvas seed must not mix with the default doc-1 room's content). */
const CANVAS_SYNC_URL = "ws://localhost:5199/canvas-demo";

/**
 * Playground page: one sync pane per tab. `?client=a|b` picks the pane's
 * letter (default a); `?syncUrl=` overrides the relay URL (the E2E smoke
 * spec points it at a real y-websocket server); `?motion=1` renders the
 * animated editor from the `docblocks-react-ui/motion` subpath instead of
 * the base `Editor`; `?catalog=1` builds the deterministic v1 catalog
 * document (the visual regression fixture, see catalog.ts) instead of the
 * empty seed; `?canvas=1` seeds the canvas demo (the page + a surface with
 * shapes, a canvas text, and a connector — see canvas-seed.ts) and starts
 * in the canvas view; `?cycle=1` seeds the pane's master doc with a sync-embed
 * referencing the outer doc (the cycle-guard e2e case). The shared chaos
 * bar above the pane drives the relay's per-room frame chaos for the
 * `?syncUrl=` room.
 */
function App() {
  const params = new URLSearchParams(window.location.search);
  const client = params.get("client") === "b" ? "b" : "a";
  const canvas = params.get("canvas") === "1";
  const syncUrl = params.get("syncUrl") ?? (canvas ? CANVAS_SYNC_URL : DEFAULT_SYNC_URL);
  const motion = params.get("motion") === "1";
  const catalog = params.get("catalog") === "1";
  const cycle = params.get("cycle") === "1";
  return (
    <>
      <ChaosBar syncUrl={syncUrl} />
      <SyncPane client={client} syncUrl={syncUrl} motion={motion} catalog={catalog} canvas={canvas} cycle={cycle} />
    </>
  );
}

export { App };
