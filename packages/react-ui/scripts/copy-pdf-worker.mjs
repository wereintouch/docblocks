#!/usr/bin/env node
/**
 * Copy the pdfjs-dist worker next to the built `./pdf` entry (dist/pdf/).
 *
 * The `./pdf` subpath references the worker by a relative path
 * (`new URL("./pdf.worker.min.mjs", import.meta.url)`) so the browser
 * resolves it against the served dist file — no bundler asset handling
 * (the dist is consumed as static ESM). This step places the worker at
 * exactly that location after the tsdown clean.
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

if (!existsSync(source)) {
  console.error(`pdf worker source not found: ${source}`);
  process.exit(1);
}
mkdirSync(targetDir, { recursive: true });
cpSync(source, target);
console.log(`pdf worker copied to dist/pdf/`);
