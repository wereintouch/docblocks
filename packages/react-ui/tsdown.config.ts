import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/motion/index.ts", "src/mermaid/index.ts", "src/pdf/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  deps: {
    // Never bundle peers or the core package — consumers provide them.
    neverBundle: ["react", "react-dom", "docblocks-core", "framer-motion", "mermaid", "pdfjs-dist"],
  },
});
