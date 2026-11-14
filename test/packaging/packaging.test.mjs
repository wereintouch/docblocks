#!/usr/bin/env node
// The packaging gate: verifies the published tarball composition and that a
// clean project installs both packages and uses the main entry, the CSS, and
// the optional subpaths — with no dependency on monorepo files (a package
// that referenced monorepo paths would not resolve outside the repo).
//
// Runs against the built dist; execute `npm run build` first. This is a
// standalone node script (it spans both workspaces and does a clean install),
// so it is wired into the gate as `npm run test:packaging` rather than a
// per-workspace vitest suite.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(here, "..", "..");

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures += 1;
    console.error(`  ✗ ${msg}`);
  } else {
    console.log(`  ✓ ${msg}`);
  }
}
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
}

const tmp = mkdtempSync(join(tmpdir(), "docblocks-pack-"));
try {
  // --- Pack both packages into a scratch dir -------------------------------
  console.log("packing the published tarballs …");
  sh("npm", ["pack", "--workspace=docblocks-core", `--pack-destination=${tmp}`]);
  sh("npm", ["pack", "--workspace=docblocks-react-ui", `--pack-destination=${tmp}`]);
  const tarballs = readdirSync(tmp).filter((f) => f.endsWith(".tgz"));
  const coreTgz = tarballs.find((f) => f.startsWith("docblocks-core-"));
  const uiTgz = tarballs.find((f) => f.startsWith("docblocks-react-ui-"));
  assert(!!coreTgz, "the core tarball packs");
  assert(!!uiTgz, "the react-ui tarball packs");
  if (!coreTgz || !uiTgz) process.exit(1);

  const list = (tgz) =>
    sh("tar", ["-tzf", join(tmp, tgz)])
      .split("\n")
      .filter(Boolean)
      .map((l) => l.replace(/^package\//, ""));

  // --- Composition: the required documents + files are in the archives -----
  // The allowlist stands the exact composition (not a prefix stand): a new
  // artifact (a font, a worker file, a chunk) must land in the list
  // consciously — the prefix stand would let an unexpected file ship
  // unreviewed.
  console.log("checking the tarball composition …");
  const coreFiles = list(coreTgz);
  for (const f of ["package.json", "README.md", "LICENSE", "dist/index.mjs", "dist/index.d.mts"]) {
    assert(coreFiles.includes(f), `the core archive carries ${f}`);
  }
  const coreAllowed = (f) =>
    f === "package.json" ||
    f === "README.md" ||
    f === "CHANGELOG.md" ||
    f === "LICENSE" ||
    f === "dist/index.mjs" ||
    f === "dist/index.d.mts";
  assert(coreFiles.every(coreAllowed), "the core archive carries no files outside the exact allowlist");

  const uiFiles = list(uiTgz);
  for (const f of [
    "package.json",
    "README.md",
    "LICENSE",
    "dist/index.mjs",
    "dist/index.d.mts",
    "dist/styles.css",
    "theme.css",
    "dist/fonts/OFL.txt",
    "dist/pdf/index.mjs",
    "dist/pdf/index.d.mts",
    "dist/pdf/pdfjs-dist/build/pdf.worker.min.mjs",
    // The static-ESM layout mirrors the package asset references.
    "dist/pdf/pdfjs-dist/wasm/jbig2.wasm",
    "dist/pdf/pdfjs-dist/wasm/jbig2_nowasm_fallback.js",
    "dist/mermaid/index.mjs",
    "dist/mermaid/index.d.mts",
  ]) {
    assert(uiFiles.includes(f), `the react-ui archive carries ${f}`);
  }
  assert(
    uiFiles.filter((f) => f.startsWith("dist/fonts/") && f.endsWith(".woff2")).length > 0,
    "the react-ui archive carries the self-hosted fonts (dist/fonts/*.woff2)"
  );
  const uiSubpathModules = [
    "dist/pdf/index.mjs",
    "dist/pdf/index.d.mts",
    "dist/pdf/pdfjs-dist/build/pdf.worker.min.mjs",
    "dist/pdf/pdfjs-dist/wasm/jbig2.wasm",
    "dist/pdf/pdfjs-dist/wasm/jbig2_nowasm_fallback.js",
    "dist/mermaid/index.mjs",
    "dist/mermaid/index.d.mts",
  ];
  // The dist's root level stands the entry + the build's hashed chunks
  // (the code-split .mjs / the d.ts chunks — the names are content-hashed,
  // so the pattern is the level + the extension); the subpath directories
  // stand the exact lists (a new file in them must land in the list
  // consciously).
  const uiAllowed = (f) =>
    f === "package.json" ||
    f === "README.md" ||
    f === "CHANGELOG.md" ||
    f === "LICENSE" ||
    f === "theme.css" ||
    f === "dist/styles.css" ||
    f === "dist/fonts/OFL.txt" ||
    (f.startsWith("dist/fonts/") && f.endsWith(".woff2")) ||
    (f.startsWith("dist/") && !f.slice("dist/".length).includes("/") && (f.endsWith(".mjs") || f.endsWith(".d.mts"))) ||
    uiSubpathModules.includes(f);
  assert(uiFiles.every(uiAllowed), "the react-ui archive carries no files outside the exact allowlist");
  assert(
    !uiFiles.some((f) => f.startsWith("dist/.tmp/")),
    "the react-ui archive carries no build intermediates (dist/.tmp)"
  );

  // --- Clean consumer: a fresh project installs both and uses them ---------
  console.log("installing both tarballs into a clean project …");
  const consumerDir = join(tmp, "consumer");
  mkdirSync(consumerDir, { recursive: true });
  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        name: "docblocks-pack-consumer",
        private: true,
        version: "0.0.0",
        type: "module",
        dependencies: {
          "docblocks-core": `file:${join(tmp, coreTgz)}`,
          "docblocks-react-ui": `file:${join(tmp, uiTgz)}`,
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          // The required peers: the base entry's page view stands the
          // framer's module evaluation, and the subpath imports stand the
          // rest (a parse error / a missing peer must fail the gate).
          "framer-motion": "^12.0.0",
          mermaid: "^12.0.0",
          "pdfjs-dist": "^6.0.0",
        },
      },
      null,
      2
    )
  );
  // The consumer install runs over an isolated npm environment, not the
  // user's: a user-level `allow-scripts` policy (npm 12) would otherwise
  // fail the install with EALLOWSCRIPTS — a false negative, since the
  // published packages carry no lifecycle scripts. The clean userconfig
  // drops the user's `~/.npmrc`, the scrubbed env drops any `npm_config_*`
  // policy vars, and `--ignore-scripts` skips scripts outright.
  const userconfigPath = join(tmp, "userconfig");
  writeFileSync(userconfigPath, "# isolated consumer install: no user-level npm policy\n");
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("npm_config_")));
  sh(
    "npm",
    [
      "install",
      `--userconfig=${userconfigPath}`,
      "--ignore-scripts",
      "--prefer-offline",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
    ],
    { cwd: consumerDir, env: cleanEnv }
  );

  // The minimal consumer: exercise the core entry, import the react-ui
  // entry + the optional subpaths (the full module evaluation — a parse
  // error stands the gate red, not only the resolution), resolve the CSS
  // (node cannot import it), and prove everything stands inside the
  // installed copy (not the monorepo).
  writeFileSync(
    join(consumerDir, "consume.mjs"),
    `import { readFileSync } from "node:fs";
import { createDoc } from "docblocks-core";

const doc = createDoc({ id: "consumer-doc" });
const para = doc.insertBlock("paragraph");
doc.insertText(para, 0, "hello from the consumer");
const json = doc.toJSON();
if (json.blocks[para]?.content?.[0]?.text !== "hello from the consumer")
  throw new Error("the core entry did not round-trip");

// The subpath imports stand the module evaluation (a parse error / a
// missing peer stands the gate red); the CSS stands the resolve + the read
// (node cannot import the css module).
const entry = await import("docblocks-react-ui");
const mermaid = await import("docblocks-react-ui/mermaid");
const pdf = await import("docblocks-react-ui/pdf");
if (typeof entry.Editor !== "function") throw new Error("the base entry did not export the Editor");
if (typeof entry.DocblocksI18nProvider !== "function")
  throw new Error("the base entry did not export the DocblocksI18nProvider");
if (typeof mermaid.MermaidCodeRenderer !== "function")
  throw new Error("the mermaid subpath did not export the renderer");
if (typeof pdf.PdfFirstPage !== "function") throw new Error("the pdf subpath did not export the preview");

const mermaidUrl = import.meta.resolve("docblocks-react-ui/mermaid");
const pdfUrl = import.meta.resolve("docblocks-react-ui/pdf");
const css = import.meta.resolve("docblocks-react-ui/styles.css");
const theme = import.meta.resolve("docblocks-react-ui/theme.css");

for (const url of [mermaidUrl, pdfUrl, css, theme]) {
  if (!url.includes("node_modules/docblocks-react-ui"))
    throw new Error(\`resolved outside the installed react-ui package: \${url}\`);
}
const cssText = readFileSync(new URL(css), "utf8");
if (cssText.length < 1000) throw new Error("styles.css is missing or empty");

console.log("CONSUMER_OK");
`
  );
  const consumerOut = sh("node", ["consume.mjs"], { cwd: consumerDir });
  assert(
    consumerOut.includes("CONSUMER_OK"),
    "the clean consumer imports the core entry + the react-ui entry / subpaths and resolves the CSS over the installed copy"
  );
} catch (err) {
  failures += 1;
  console.error(`  ✗ ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} packaging check(s) failed` : "\npackaging: all checks passed");
process.exit(failures ? 1 : 0);
