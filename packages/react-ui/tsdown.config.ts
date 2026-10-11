import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/motion/index.tsx", "src/mermaid/index.tsx"],
  format: ["esm"],
  dts: true,
  clean: true,
  deps: {
    // Never bundle peers or the core package — consumers provide them.
    neverBundle: ["react", "react-dom", "docblocks-core", "framer-motion", "mermaid"],
  },
});
