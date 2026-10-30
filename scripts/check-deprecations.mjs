#!/usr/bin/env node
// The deprecation gate: reports the TypeScript "is deprecated" diagnostics
// (the @deprecated JSDoc ones the editor surfaces) across the tsconfigs the
// typecheck covers, and fails the gate on any of them. The `tsc` CLI never
// reports suggestion diagnostics, so the gate collects them through the
// compiler API (`ts.computeSuggestionDiagnostics`) per tsconfig program.
//
// An intentional use is suppressed with an inline `// deprecation-allow:
// <reason>` marker: a trailing marker on the flagged line, or a marker-only
// comment line directly above it (blank lines in between stand).
//
// Usage: node scripts/check-deprecations.mjs [tsconfig.json ...]
// (defaults: the tsconfigs `npm run typecheck` covers).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "..");

// The tsconfigs `npm run typecheck` covers (the workspaces + the e2e project).
const DEFAULT_CONFIGS = [
  "packages/core/tsconfig.json",
  "packages/react-ui/tsconfig.json",
  "apps/playground/tsconfig.json",
  "test/e2e/tsconfig.json",
];

// The inline suppression marker: an intentional use of a deprecated API.
const ALLOW_MARKER = /deprecation-allow:/;

// The suppression lines of one source file: a trailing marker (code + the
// marker comment) stands its own line; a marker-only comment line stands the
// next non-empty line (a multi-line expression whose deprecation lands below
// the marker's line).
function suppressedLines(lines) {
  const suppressed = new Set();
  lines.forEach((line, index) => {
    if (!ALLOW_MARKER.test(line)) return;
    if (line.trim().startsWith("//")) {
      for (let below = index + 1; below < lines.length; below += 1) {
        if (lines[below].trim() !== "") {
          suppressed.add(below);
          break;
        }
      }
      return;
    }
    suppressed.add(index);
  });
  return suppressed;
}

// The "is deprecated" diagnostics of one tsconfig program, the allow-marked
// uses dropped (the position key dedupes the repeated reports).
function collectDeprecations(configRel) {
  const configPath = path.resolve(repoRoot, configRel);
  const { config, error } = ts.readConfigFile(configPath, (p) => readFileSync(p, "utf8"));
  if (error) {
    throw new Error(`${configRel}: ${ts.flattenDiagnosticMessageText(error.messageText, " ")}`);
  }
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, path.dirname(configPath));
  if (parsed.errors.length > 0) {
    throw new Error(
      `${configRel}: ${parsed.errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; ")}`
    );
  }
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });

  const found = new Map();
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile || !parsed.fileNames.includes(sourceFile.fileName)) continue;
    const lines = sourceFile.getFullText().split("\n");
    const suppressed = suppressedLines(lines);
    for (const d of ts.computeSuggestionDiagnostics(sourceFile, program, ts.cancellationToken)) {
      const message = ts.flattenDiagnosticMessageText(d.messageText, " ");
      if (!message.includes("is deprecated")) continue;
      const pos = d.file.getLineAndCharacterOfPosition(d.start);
      if (suppressed.has(pos.line)) continue;
      found.set(`${path.relative(repoRoot, sourceFile.fileName)}:${pos.line + 1}:${pos.character + 1}`, message);
    }
  }
  return found;
}

const configs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_CONFIGS;
const startedAt = Date.now();
let total = 0;

for (const configRel of configs) {
  let found;
  try {
    found = collectDeprecations(configRel);
  } catch (error) {
    console.error(`deprecation gate: ${error.message}`);
    process.exit(2);
  }
  total += found.size;
  if (found.size === 0) continue;
  console.log(`${configRel}:`);
  for (const [where, message] of found) {
    console.log(`  ${where}  ${message}`);
  }
}

const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
if (total > 0) {
  console.error(
    `deprecation gate: FAIL — ${total} deprecated usage(s) across ${configs.length} tsconfig(s) ` +
      `(${seconds}s). Fix the usage, or mark an intentional one with ` +
      "`// deprecation-allow: <reason>`."
  );
  process.exit(1);
}
console.log(`deprecation gate: clean (${configs.length} tsconfig(s), ${seconds}s)`);
