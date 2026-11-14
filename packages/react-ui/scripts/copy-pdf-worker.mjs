#!/usr/bin/env node
/** Copy the pdfjs-dist worker and JBIG2 decoder into the static-ESM asset
 * layout after the tsdown clean. Bundlers resolve the same package
 * references into their own asset pipelines. */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(new URL(import.meta.url)));
const root = join(scriptDir, "..");
const requireFromPackage = createRequire(join(root, "package.json"));
const source = requireFromPackage.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const targetDir = join(root, "dist", "pdf", "pdfjs-dist", "build");
const target = join(targetDir, "pdf.worker.min.mjs");
const wasmDir = join(dirname(source), "..", "wasm");
const wasmTargetDir = join(root, "dist", "pdf", "pdfjs-dist", "wasm");
const jbig2Files = ["jbig2.wasm", "jbig2_nowasm_fallback.js"];

if (!existsSync(source)) {
  console.error(`pdf worker source not found: ${source}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
mkdirSync(wasmTargetDir, { recursive: true });
cpSync(source, target);
for (const file of jbig2Files) {
  const src = join(wasmDir, file);
  if (!existsSync(src)) {
    console.error(`pdf jbig2 decoder source not found: ${src}`);
    process.exit(1);
  }
  cpSync(src, join(wasmTargetDir, file));
}
console.log(`pdf worker + jbig2 decoder (${jbig2Files.join(", ")}) copied to dist/pdf/pdfjs-dist/`);
