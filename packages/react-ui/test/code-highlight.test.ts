/**
 * The code highlight service pins: the (text, language) → overlay HTML
 * contract — the known-language token spans, the plain languages (no
 * layer), the determinism, the lenient edge cases, the output structure
 * guard, and the grammar load cache.
 *
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import { highlightCode, loadGrammar } from "../src/blocks/code-highlight";

// A mocked grammar module that fails to load (the transient chunk fetch
// failure pin — the "c" grammar is used by that pin only in this file).
vi.mock("highlight.js/lib/languages/c", () => {
  throw new Error("chunk fetch failed");
});

const PYTHON = "def main():\n    if True:\n        x = 1\n    return x\n";

describe("highlightCode", () => {
  it("turns a known language into hljs token spans", async () => {
    const html = await highlightCode(PYTHON, "python");
    expect(html).not.toBeNull();
    expect(html).toContain('<span class="hljs-keyword">def</span>');
    expect(html).toContain("hljs-title");
  });

  it("is deterministic (the same input yields the same fragment)", async () => {
    expect(await highlightCode(PYTHON, "python")).toBe(await highlightCode(PYTHON, "python"));
  });

  it("resolves null for the plain languages (absent, mermaid, unknown)", async () => {
    expect(await highlightCode("any", "")).toBeNull();
    expect(await highlightCode("any", undefined)).toBeNull();
    expect(await highlightCode("graph TD\n A-->B", "mermaid")).toBeNull();
    expect(await highlightCode("any", "nail")).toBeNull();
  });

  it("maps toml to the ini grammar", async () => {
    const html = await highlightCode("[table]\nkey = 1\n", "toml");
    expect(html).not.toBeNull();
    expect(html).toContain("hljs-");
  });

  it("stays lenient on a grammar edge case (ignoreIllegals)", async () => {
    expect(await highlightCode("def :(", "python")).not.toBeNull();
  });

  it("emits only span tags (the structure guard)", async () => {
    for (const language of ["python", "javascript", "json", "yaml", "xml", "rust"]) {
      const html = await highlightCode(PYTHON, language);
      if (html !== null)
        expect(html, `the ${language} output should carry no foreign tag`).not.toMatch(/<(?!\/?span[\s>])/u);
    }
  });

  it("escapes the source text (the raw '<' never lands in the output)", async () => {
    const html = await highlightCode("<script></script>\na = b < c", "python");
    expect(html).not.toBeNull();
    expect(html).toContain("&lt;");
    expect(html).not.toContain("<script");
  });
});

describe("loadGrammar", () => {
  it("caches the load (a second call shares the first promise)", () => {
    expect(loadGrammar("python")).toBe(loadGrammar("python"));
  });

  it("resolves so the grammar is registered", async () => {
    await loadGrammar("go");
    // a second highlight of the loaded language resolves a real fragment
    expect(await highlightCode("package main\n", "go")).not.toBeNull();
  });

  it("a failed load is evicted from the cache (retryable) and never poisons highlightCode", async () => {
    const first = loadGrammar("c");
    await expect(first).rejects.toThrow();
    const second = loadGrammar("c");
    expect(second).not.toBe(first);
    await expect(second).rejects.toThrow();
    // highlightCode degrades a failed load to plain text (null, no rejection)
    expect(await highlightCode("int a;\n", "c")).toBeNull();
  });
});
