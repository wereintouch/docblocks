import { describe, expect, it } from "vitest";

import { createDoc, fromJSON } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

describe("the embed's src stands the unsafe-scheme rejection", () => {
  // The kind x src cross-field rule: the write posture
  // rejects the `javascript:` / the foreign `data:` (the XSS over the
  // consumer's `allow-same-origin` + `allow-scripts` grant, the phishing
  // surface); the lenient load keeps the value as data (the renderer gates
  // it), the `html` kind stands its own `data:text/html` snippet.
  it("the write posture rejects the unsafe scheme (the insert + the update stands)", () => {
    const doc = createDoc({ id: "d" });
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "javascript:alert(1)" })).toThrow(/not a safe URL/);
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "data:text/html,<script>alert(1)</script>" })).toThrow(
      /not a safe URL/
    );
    // The browser's leading-control trim (the `javascript:` after the C0
    // run stands the scheme detection's bypass) is undone.
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "\tjavascript:alert(1)" })).toThrow(/not a safe URL/);
    const id = doc.insertBlock("embed", { kind: "iframe", src: "https://example.com" });
    expect(() => doc.updateBlock(id, { src: "javascript:alert(1)" })).toThrow(/not a safe URL/);
    expect(() => doc.updateBlock(id, { src: "data:text/html,<x>" })).toThrow(/not a safe URL/);
    // The safe stand: the absolute http/https over every kind.
    doc.updateBlock(id, { src: "https://github.com/x/y" });
  });

  it("the html kind stands the data:text/html snippet (the kind's purpose)", () => {
    const doc = createDoc({ id: "d" });
    const html = doc.insertBlock("embed", { kind: "html", src: "data:text/html,<h1>hi</h1>" });
    doc.updateBlock(html, { src: "data:text/html;base64,PGgxPmhpPC9oPg==" });
    doc.insertBlock("embed", { kind: "html", src: "https://example.com/page.html" });
  });

  it("the strict validator rejects the unsafe src; the lenient load keeps it (the data stand)", () => {
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-10-10T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["e"] },
        e: { type: "embed" as const, attrs: { kind: "iframe", src: "javascript:alert(1)" } },
      },
    };
    expect(validateDoc(JSON.parse(JSON.stringify(base)) as DocJSON).some((e) => e.path.includes("src"))).toBe(true);
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    const block = loaded.getBlock("e") as { attrs?: { src?: string } } | null;
    expect(block?.attrs?.src).toBe("javascript:alert(1)");
  });
});
