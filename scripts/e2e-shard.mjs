#!/usr/bin/env node
// The sharded E2E runner: splits the suite's spec files across N independent
// dev servers (each with its own in-process relay on unique ports) and runs
// them in parallel. The single vite+relay process is the suite's contention
// point (the measured 2026-11: workers 4 on one server flakes under a loaded
// machine, while 3 servers x 2 workers stands clean and ~45% faster).
//
// The split is a round-robin by file, not Playwright's contiguous --shard:
// the heavy canvas files cluster alphabetically, and a contiguous chunk
// lands them all in one shard (the wall clock's bounding shard).
//
// Usage: node scripts/e2e-shard.mjs
//   SHARDS  — the shard count (default 3)
//   WORKERS — the per-shard workers (default 2; total = SHARDS * WORKERS)
//   RETRIES — the per-test retries (default 1, the local e2e's stand)
//   SHARD_BASE_PORT — the first dev-server port (default 40000; the relay
//                     sits 100 above it, both inside 40000..40999)
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "..");

const SHARDS = Number(process.env.SHARDS ?? 3);
const WORKERS = Number(process.env.WORKERS ?? 2);
const RETRIES = Number(process.env.RETRIES ?? 1);
const BASE_VITE = Number(process.env.SHARD_BASE_PORT ?? 40000);
const BASE_RELAY = BASE_VITE + 100;

if (BASE_RELAY + SHARDS > 40999) {
  console.error(`e2e-shard: SHARDS=${SHARDS} overflows the 40000..40999 port range`);
  process.exit(1);
}

const e2eDir = path.join(repoRoot, "test", "e2e");
const outDir = path.join(repoRoot, ".tmp", "e2e-shard");

const files = readdirSync(e2eDir)
  .filter((name) => name.endsWith(".spec.ts"))
  .sort();

// Round-robin by file: the heavy canvas files (a contiguous alphabetical
// block) spread one per shard, so each shard carries a comparable load.
const buckets = Array.from({ length: SHARDS }, () => []);
files.forEach((file, index) => buckets[index % SHARDS].push(file));

mkdirSync(outDir, { recursive: true });

/** The dot reporter's final summary lines (a pass prints one "N passed"
 *  line; a failure prints the flaky/failed/did-not-run counts above it). */
function parseSummary(log) {
  const count = (pattern) => Number(log.match(pattern)?.[1] ?? 0);
  return {
    passed: count(/(\d+) passed/),
    failed: count(/(\d+) failed/),
    flaky: count(/(\d+) flaky/),
    didNotRun: count(/(\d+) did not run/),
  };
}

function runShard(index) {
  const vite = BASE_VITE + index + 1;
  const relay = BASE_RELAY + index + 1;
  const shardFiles = buckets[index].map((file) => path.join(e2eDir, file));
  const logPath = path.join(outDir, `shard-${index + 1}.log`);

  const args = [
    "--no-install",
    "playwright",
    "test",
    "--project=chromium",
    "--workers",
    String(WORKERS),
    "--reporter=dot",
    ...shardFiles,
  ];
  const child = spawn("npx", args, {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      DOCBLOCKS_PORT: String(vite),
      DOCBLOCKS_RELAY_PORT: String(relay),
      PLAYWRIGHT_RETRIES: String(RETRIES),
    },
  });

  const started = Date.now();
  console.log(`shard ${index + 1}/${SHARDS}: ${shardFiles.length} files on :${vite} (relay :${relay})`);

  return new Promise((resolve) => {
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("close", (code) => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      writeFileSync(logPath, output);
      const summary = parseSummary(output);
      const totals = `${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky`;
      console.log(`shard ${index + 1}/${SHARDS}: ${totals} (${seconds}s${code === 0 ? "" : ", exit " + code})`);
      resolve({ index, code, summary });
    });
  });
}

const results = await Promise.all(Array.from({ length: SHARDS }, (_, index) => runShard(index)));

const totals = results.reduce(
  (acc, { summary }) => ({
    passed: acc.passed + summary.passed,
    failed: acc.failed + summary.failed,
    flaky: acc.flaky + summary.flaky,
    didNotRun: acc.didNotRun + summary.didNotRun,
  }),
  { passed: 0, failed: 0, flaky: 0, didNotRun: 0 }
);

console.log(
  `e2e-shard: ${totals.passed} passed, ${totals.failed} failed, ${totals.flaky} flaky` +
    (totals.didNotRun ? `, ${totals.didNotRun} did not run` : "")
);

if (results.some(({ code }) => code !== 0)) process.exit(1);
