#!/usr/bin/env node
/**
 * Copy the pdfjs-dist worker next to the built `./pdf` entry (dist/pdf/).
 *
 * The `./pdf` subpath references the worker by a relative path
 * (`new URL("./pdf.worker.min.mjs", import.meta.url)`) so the browser
 * resolves it against the served dist file — no bundler asset handling
 * (the dist is consumed as static ESM). This step places the worker — and
 * the JBIG2 decoder files the worker loads from `wasmUrl` (the wasm module
 * and the no-wasm js fallback) — at exactly that location after the tsdown
 * clean. Scanned PDFs encode their text layers as JBIG2; without the decoder
 * the worker fails to initialize those layers and the page renders as a bare
 * background image.
 */
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(new URL(import.meta.url)));
const root = join(scriptDir, "..");
const requireFromPackage = createRequire(join(root, "package.json"));
const source = requireFromPackage.resolve("pdfjs-dist/build/pdf.worker.min.mjs");
const targetDir = join(root, "dist", "pdf");
const target = join(targetDir, "pdf.worker.min.mjs");
// The JBIG2 decoder ships in pdfjs-dist's wasm/ dir (next to the worker's
// package root) and is loaded by the worker from the `wasmUrl` base.
const wasmDir = join(dirname(source), "..", "wasm");
const jbig2Files = ["jbig2.wasm", "jbig2_nowasm_fallback.js"];

if (!existsSync(source)) {
  console.error(`pdf worker source not found: ${source}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
cpSync(source, target);
for (const file of jbig2Files) {
  const src = join(wasmDir, file);
  if (!existsSync(src)) {
    console.error(`pdf jbig2 decoder source not found: ${src}`);
    process.exit(1);
  }
  cpSync(src, join(targetDir, file));
}
console.log(`pdf worker + jbig2 decoder (${jbig2Files.join(", ")}) copied to dist/pdf/`);
