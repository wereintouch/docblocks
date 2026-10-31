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
  console.log("checking the tarball composition …");
  const coreFiles = list(coreTgz);
  for (const f of ["package.json", "README.md", "LICENSE", "dist/index.mjs", "dist/index.d.mts"]) {
    assert(coreFiles.includes(f), `the core archive carries ${f}`);
  }
  const coreAllowed = (f) =>
    f === "package.json" || f === "README.md" || f === "CHANGELOG.md" || f === "LICENSE" || f.startsWith("dist/");
  assert(
    coreFiles.every(coreAllowed),
    "the core archive carries no files outside package.json / README / LICENSE / CHANGELOG / dist"
  );

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
    "dist/pdf/pdf.worker.min.mjs",
    "dist/pdf/index.mjs",
    "dist/mermaid/index.mjs",
    "dist/motion/index.mjs",
  ]) {
    assert(uiFiles.includes(f), `the react-ui archive carries ${f}`);
  }
  assert(
    uiFiles.some((f) => f.endsWith(".woff2")),
    "the react-ui archive carries the self-hosted fonts (dist/fonts/*.woff2)"
  );
  const uiAllowed = (f) =>
    f === "package.json" ||
    f === "README.md" ||
    f === "CHANGELOG.md" ||
    f === "LICENSE" ||
    f === "theme.css" ||
    f.startsWith("dist/");
  assert(
    uiFiles.every(uiAllowed),
    "the react-ui archive carries no files outside package.json / README / LICENSE / CHANGELOG / dist / theme.css"
  );
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

  // The minimal consumer: exercise the core entry, resolve the react-ui entry
  // + CSS + optional subpaths, and prove they resolve inside the installed
  // copy (not the monorepo).
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

const entry = import.meta.resolve("docblocks-react-ui");
const motion = import.meta.resolve("docblocks-react-ui/motion");
const mermaid = import.meta.resolve("docblocks-react-ui/mermaid");
const pdf = import.meta.resolve("docblocks-react-ui/pdf");
const css = import.meta.resolve("docblocks-react-ui/styles.css");
const theme = import.meta.resolve("docblocks-react-ui/theme.css");

for (const url of [entry, motion, mermaid, pdf, css, theme]) {
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
    "the clean consumer uses the core entry + the react-ui entry / CSS / optional subpaths"
  );
} catch (err) {
  failures += 1;
  console.error(`  ✗ ${err.message}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} packaging check(s) failed` : "\npackaging: all checks passed");
process.exit(failures ? 1 : 0);
