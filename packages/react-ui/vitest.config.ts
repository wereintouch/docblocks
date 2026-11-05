import path from "node:path";
import { defineConfig } from "vitest/config";

const dir = import.meta.dirname;

// Unit tests resolve docblocks-core the same way published consumers do
// (package.json exports -> dist/), so the root `check` builds packages
// before running tests.
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      // The harness's in-memory reference bridge stands as the database
      // tests' fixture: the package tests import it by name (the bridge is a
      // consumer implementation, moved to the playground harness).
      "@playground/memory-bridge": path.resolve(dir, "../../apps/playground/src/memory-bridge/index.ts"),
      // The reference bridge is a consumer: it imports the package's public
      // API by its bare name. The package tests resolve that self-import to
      // src (no dist build required for the unit gate).
      "docblocks-react-ui": path.resolve(dir, "src/index.ts"),
    },
  },
});
