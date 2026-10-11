import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { type Plugin, defineConfig } from "vite";

import { type RelayHandle, startRelay } from "./server/relay.ts";

// Strict: the E2E specs and the pane's default ?syncUrl= point at this port.
const RELAY_PORT = 5199;

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
    relay = startRelay(RELAY_PORT)
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
  // Dev convenience: resolve docblocks-core from source until a build exists.
  // Exact match only — deep imports are forbidden by the boundary gate. The
  // layer aliases mirror packages/core/tsconfig.json (vite does not read
  // tsconfig paths); they are needed to resolve core's internal imports.
  resolve: {
    alias: [
      {
        find: /^docblocks-core$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
      {
        find: /^@docblocks-core\/schema$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/schema/index.ts", import.meta.url)),
      },
      {
        find: /^@docblocks-core\/core$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/core/index.ts", import.meta.url)),
      },
    ],
  },
});
