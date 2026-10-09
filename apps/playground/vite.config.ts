import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // strictPort: the Playwright webServer probe expects exactly this port.
  server: { port: 5173, strictPort: true },
  // Dev convenience: resolve docblocks-core from source until a build exists.
  // Exact match only — deep imports are forbidden by the boundary gate.
  resolve: {
    alias: [
      {
        find: /^docblocks-core$/,
        replacement: fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)),
      },
    ],
  },
});
