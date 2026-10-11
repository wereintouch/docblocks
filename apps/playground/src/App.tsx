import { SyncPane } from "./SyncPane";

/** The in-process dev relay (see vite.config.ts). */
const DEFAULT_SYNC_URL = "ws://localhost:5199/doc-1";

/**
 * Playground page: one sync pane per tab. `?client=a|b` picks the pane's
 * letter (default a); `?syncUrl=` overrides the relay URL (the E2E smoke
 * spec points it at a real y-websocket server).
 */
function App() {
  const params = new URLSearchParams(window.location.search);
  const client = params.get("client") === "b" ? "b" : "a";
  const syncUrl = params.get("syncUrl") ?? DEFAULT_SYNC_URL;
  return <SyncPane client={client} syncUrl={syncUrl} />;
}

export { App };
