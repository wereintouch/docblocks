import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Built artifacts only: the root gate builds the packages before the tests
// run (a consumer view — like the sibling-package resolution), so the
// assertions below read the emitted dist, not the source.
const DIST = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

/** All files under a directory (recursive). */
function filesOf(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name);
    return statSync(file).isDirectory() ? filesOf(file) : [file];
  });
}

describe("subpath split (built artifacts)", () => {
  it("keeps framer-motion out of the base entry", () => {
    expect(readFileSync(join(DIST, "index.mjs"), "utf8")).not.toContain("framer-motion");
    expect(readFileSync(join(DIST, "index.d.mts"), "utf8")).not.toContain("framer-motion");
  });

  it("keeps the motion subpath the only framer-motion consumer in dist", () => {
    const withFramer = filesOf(DIST).filter((file) => readFileSync(file, "utf8").includes("framer-motion"));
    // The shared chunk and every type file stay framer-free as well.
    expect(withFramer).toEqual([join(DIST, "motion/index.mjs")]);
  });

  it("ships the motion entry importing framer-motion", () => {
    expect(readFileSync(join(DIST, "motion/index.mjs"), "utf8")).toContain('from "framer-motion"');
  });

  it("keeps mermaid out of the base entry", () => {
    expect(readFileSync(join(DIST, "index.mjs"), "utf8")).not.toContain("mermaid");
    expect(readFileSync(join(DIST, "index.d.mts"), "utf8")).not.toContain("mermaid");
  });

  it("keeps the mermaid subpath the only mermaid consumer in dist", () => {
    const withMermaid = filesOf(DIST).filter((file) => readFileSync(file, "utf8").includes('from "mermaid"'));
    // The shared chunk and every type file stay mermaid-free as well.
    expect(withMermaid).toEqual([join(DIST, "mermaid/index.mjs")]);
  });

  it("ships the mermaid entry importing mermaid", () => {
    expect(readFileSync(join(DIST, "mermaid/index.mjs"), "utf8")).toContain('from "mermaid"');
  });
});
