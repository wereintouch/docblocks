import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Layer aliases (mirrors tsconfig paths) — vite does not read tsconfig paths.
    alias: {
      "@docblocks-core/schema": path.join(dir, "src", "schema", "index.ts"),
      "@docblocks-core/core": path.join(dir, "src", "core", "index.ts"),
    },
  },
  test: { environment: "node" },
});
