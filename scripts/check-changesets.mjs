#!/usr/bin/env node
// The changeset frontmatter gate: parses every pending changeset with the
// real changesets parser so a broken fence fails here loudly instead of
// surfacing later as a false "no pending changesets" (the publish flow
// treats a parse failure of the whole .changeset/ directory as an empty
// one and stops).
//
// Usage: node scripts/check-changesets.mjs
import { parseChangesetFile } from "@changesets/parse";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(here, "..");
const dir = path.join(repoRoot, ".changeset");

if (!existsSync(dir)) process.exit(0);

// The directory's README (the changesets convention's own file) is not a
// changeset.
const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");

let failed = false;
for (const file of files) {
  try {
    // The parser takes the file's contents (not a path) and validates the
    // frontmatter YAML + the release types as well as the fences.
    parseChangesetFile(readFileSync(path.join(dir, file), "utf8"));
  } catch (error) {
    console.error(`check:changesets: ${file}: ${error instanceof Error ? error.message : String(error)}`);
    failed = true;
  }
}
if (failed) process.exit(1);
