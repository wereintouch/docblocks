import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const fileDir = path.dirname(fileURLToPath(import.meta.url));

// The reference bridge's conformance suite: the harness tests its own
// in-memory bridge against the package's public contract (the bare
// `docblocks-react-ui` import resolves to the package's src, the same view
// the package's own unit tests stand — no dist build required).
export default defineConfig({
  test: { environment: "node" },
  resolve: {
    alias: {
      "docblocks-react-ui": path.resolve(fileDir, "../../packages/react-ui/src/index.ts"),
    },
  },
});
