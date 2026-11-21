// @vitest-environment jsdom
// The headless whole-document import's goldens: the markdown / HTML's
// payload fills the fresh doc (the full `toJSON()`'s stand) + the
// non-empty import's single transaction (one `onChange` emission).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Change, Doc } from "docblocks-core";

import { importDocument } from "../src/index";
import { HTML_GOLDEN, HTML_SOURCE } from "./import-document.html-goldens";
import { MD_GOLDEN, MD_SOURCE } from "./import-document.md-goldens";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

/** The fresh doc: the empty root, the deterministic ids (the counter). */
function freshDoc(): Doc {
  let n = 0;
  return createDoc({
    id: "doc1",
    title: "",
    createdAt: CREATED_AT,
    generateId: () => `b${String(++n).padStart(3, "0")}`,
  });
}

describe("importDocument — the goldens (the full toJSON())", () => {
  it("the markdown payload fills the fresh doc (the parser's corpus)", () => {
    const doc = freshDoc();
    importDocument(doc, MD_SOURCE, "markdown");
    expect(doc.toJSON()).toEqual(MD_GOLDEN);
  });

  it("the HTML payload fills the fresh doc (the block structure + the inline whitelist)", () => {
    const doc = freshDoc();
    importDocument(doc, HTML_SOURCE, "html");
    expect(doc.toJSON()).toEqual(HTML_GOLDEN);
  });
});

describe("importDocument — the single transaction", () => {
  it("the non-empty import runs ONE transact (one onChange emission)", () => {
    const doc = freshDoc();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    importDocument(doc, MD_SOURCE, "markdown");
    off();
    expect(changes).toHaveLength(1);
    // Every block's snapshot changed in the one transaction (the new
    // blocks + the parents' children lists, the root included).
    expect(new Set(changes[0]!.blockIds)).toEqual(new Set(Object.keys(MD_GOLDEN.blocks)));
  });
});
