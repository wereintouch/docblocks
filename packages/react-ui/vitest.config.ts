import { defineConfig } from "vitest/config";

// Unit tests resolve docblocks-core the same way published consumers do
// (package.json exports -> dist/), so the root `check` builds packages
// before running tests.
export default defineConfig({
  test: { environment: "node" },
});
