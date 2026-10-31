import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The package ships a built ESM dist — the bundler strips the `use client`
// directive at build time, so a directive in the source is a no-op for the
// consumer (who imports the dist) and only logs a module-level-directive
// warning per file on every build. The source therefore stands none.
const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const DIRECTIVE = /^\s*["']use client["']\s*;?\s*$/;

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(path)));
    else if (/\.[jt]sx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

describe("the shared source carries no `use client` directive", () => {
  it("no source file stands the directive (the built dist is the consumer's entry)", async () => {
    const offenders = (await Promise.all(
      (await collectSourceFiles(SRC)).map(async (file) => {
        const lines = (await readFile(file, "utf8")).split("\n");
        return lines.some((line) => DIRECTIVE.test(line)) ? file : null;
      })
    )).filter((file) => file !== null);
    expect(offenders).toEqual([]);
  });
});
