import { ChaosBar } from "./ChaosBar";
import { SyncPane } from "./SyncPane";

/** The in-process dev relay (see vite.config.ts). */
const DEFAULT_SYNC_URL = "ws://localhost:5199/doc-1";

/**
 * Playground page: one sync pane per tab. `?client=a|b` picks the pane's
 * letter (default a); `?syncUrl=` overrides the relay URL (the E2E smoke
 * spec points it at a real y-websocket server); `?motion=1` renders the
 * animated editor from the `docblocks-react-ui/motion` subpath instead of
 * the base `Editor`. The shared chaos bar above the pane drives the
 * relay's per-room frame chaos for the `?syncUrl=` room.
 */
function App() {
  const params = new URLSearchParams(window.location.search);
  const client = params.get("client") === "b" ? "b" : "a";
  const syncUrl = params.get("syncUrl") ?? DEFAULT_SYNC_URL;
  const motion = params.get("motion") === "1";
  return (
    <>
      <ChaosBar syncUrl={syncUrl} />
      <SyncPane client={client} syncUrl={syncUrl} motion={motion} />
    </>
  );
}

export { App };
