import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

import { type RelayHandle, startRelay } from "./server/relay.ts";

// Strict: the E2E specs and the pane's default ?syncUrl= point at this port.
const RELAY_PORT = 5199;

// The relay binds loopback (127.0.0.1) by default — it is a dev-only sync
// harness, not a network service. An explicit non-loopback bind
// (DOCBLOCKS_RELAY_HOST) is only honored together with a token
// (DOCBLOCKS_RELAY_TOKEN); a host without a token fails the start.
const RELAY_HOST = process.env.DOCBLOCKS_RELAY_HOST;
const RELAY_TOKEN = process.env.DOCBLOCKS_RELAY_TOKEN;

// The pending/started relay of the current dev server session; null when none.
let relay: Promise<RelayHandle | null> | null = null;

/**
 * Hosts the y-protocols relay in-process with the dev server: started on
 * boot (and logged so E2E can rely on readiness), stopped in `closeServer`
 * (the function returned by `configureServer` is a post-startup hook, not
 * a cleanup).
 */
const relayPlugin: Plugin = {
  name: "docblocks-ws-relay",
  configureServer() {
    relay = startRelay(RELAY_PORT, { host: RELAY_HOST, token: RELAY_TOKEN })
      .then((handle) => {
        console.log(`ws relay on :${RELAY_PORT}`);
        return handle;
      })
      .catch((error: unknown) => {
        console.error(`ws relay failed to start on :${RELAY_PORT}`, error);
        return null;
      });
  },
  async closeServer() {
    const pending = relay;
    relay = null;
    if (pending === null) return;
    const handle = await pending;
    if (handle !== null) await handle.stop().catch(() => undefined);
  },
};

export default defineConfig({
  plugins: [react(), relayPlugin],
  // Fixed at this port: the Playwright webServer probe and the ws relay
  // (5199) are addressed by the e2e specs at exactly these ports.
  server: { port: 5173, strictPort: true },
  // The consumer view stands over both packages: neither docblocks-core nor
  // docblocks-react-ui carries an alias — each resolves through the workspace
  // symlink + the package.json's exports map to the built dist, the same way
  // a consumer sees it (run the build after a source change, or the dev
  // server / the e2e suite stands the stale dist). No source alias:
  // - the e2e's consumer view covers the core's dist too (a broken dist
  //   stands the suite red, not only the react-ui's);
  // - a source alias for the react-ui base entry would give the
  //   `EditorProvider` context a second, dist-side copy inside the `./motion`
  //   entry, and a React context is only shared between modules compiled
  //   from one file.
  resolve: {
    alias: [],
  },
});
