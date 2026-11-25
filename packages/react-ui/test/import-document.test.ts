// @vitest-environment jsdom
// The headless whole-document import (`importDocument`): the markdown / HTML
// payload fills a FRESH doc (the empty root) over the paste parsers'
// materialization — one transaction (one undo step, one wire update), the
// indents absolute (the jump-rule clamp, no seat), the empty payload the
// no-op, the non-fresh doc the typed rejection. The goldens are the full
// `toJSON()` over a deterministic doc (the counter `generateId` — the
// determinism criterion: the command sequence stands the stable JSON). The
// HTML kind needs the DOM (the `DOMParser` over the jsdom environment).
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Change, Doc } from "docblocks-core";

import { ImportDocumentError, importDocument } from "../src/index";

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

describe("importDocument — the indents (absolute, the jump-rule clamp)", () => {
  it("the parser's nesting stands as the indents (the no re-base)", () => {
    const doc = freshDoc();
    importDocument(doc, "- a\n  - b\n    - c\n", "markdown");
    const ids = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
    expect(doc.toJSON().blocks[ids[1]!]).toMatchObject({ type: "list-item", attrs: { indent: 1 } });
    expect(doc.toJSON().blocks[ids[2]!]).toMatchObject({ type: "list-item", attrs: { indent: 2 } });
  });

  it("the dropped-parent gap clamps (the first block anchors at 0, the core's jump rule)", () => {
    // The whitespace-only parents are dropped by the parser: the deep item
    // would land at indent 2 over the empty root (the core rejects the
    // first block's indent > 0 — the whole import would roll back); the
    // clamp keeps the content at the anchored indent 0.
    const doc = freshDoc();
    importDocument(doc, "<ul><li>  <ul><li>  <ul><li>deep</li></ul></li></ul></li></ul>", "html");
    const [id] = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[id!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
  });

  it("a gap in the middle of the sequence clamps to the predecessor + 1", () => {
    // The nested ul under a whitespace-only item is dropped: "deep" stands
    // at the parser's indent 1 over the anchor (the +1 cap holds — no
    // violation), and the deeper gap over it clamps.
    const doc = freshDoc();
    importDocument(doc, "<ul><li>anchor</li><li>  <ul><li>  <ul><li>deep</li></ul></li></ul></li></ul>", "html");
    const ids = doc.getChildren(doc.meta.id);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "list-item", attrs: { indent: 0 } });
    expect(doc.toJSON().blocks[ids[1]!]).toMatchObject({ type: "list-item", attrs: { indent: 1 } });
  });
});

describe("importDocument — the fresh-doc precondition", () => {
  it("the non-fresh doc (the root has children) throws the typed error", () => {
    const doc = freshDoc();
    doc.insertBlock("paragraph", undefined, { parent: doc.meta.id });
    expect(() => importDocument(doc, "# T", "markdown")).toThrow(ImportDocumentError);
    // The doc stands: the single seeded paragraph, nothing imported.
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
  });

  it("the import stands once: the second import throws (the root is no longer empty)", () => {
    const doc = freshDoc();
    importDocument(doc, "# T", "markdown");
    expect(() => importDocument(doc, "# Again", "markdown")).toThrow(ImportDocumentError);
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1);
  });
});

describe("importDocument — the markdown image lines (the drop)", () => {
  it("the image line stands no block (the html paste's `img` parity)", () => {
    const doc = freshDoc();
    importDocument(doc, "# T\n\n![pic](pic.png)\n\ntext", "markdown");
    const types = doc.getChildren(doc.meta.id).map((id) => doc.getBlock(id)!.type);
    expect(types).toEqual(["heading", "paragraph"]);
  });

  it("an image-only payload writes nothing and runs no transaction", () => {
    const doc = freshDoc();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    importDocument(doc, "![pic](pic.png)", "markdown");
    off();
    expect(doc.getChildren(doc.meta.id)).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });
});

describe("importDocument — the empty payload (the no-op)", () => {
  // The emptiness is per kind: the structural-tag payload is the literal
  // text over the markdown (the parser's degrade) and the nothing over the
  // HTML (the whitespace-only stand) — the cases stand per kind.
  const cases: Array<[string, "markdown" | "html"]> = [
    ["", "markdown"],
    ["   ", "markdown"],
    ["\n\n  \n", "markdown"],
    ["", "html"],
    ["<p>   </p>", "html"],
    ["<div>  </div>", "html"],
  ];
  it.each(cases)("the empty / whitespace-only payload (%s) writes nothing and runs no transaction", (source, kind) => {
    const doc = freshDoc();
    const changes: Change[] = [];
    const off = doc.onChange((change) => changes.push(change));
    importDocument(doc, source, kind);
    off();
    expect(doc.getChildren(doc.meta.id)).toHaveLength(0);
    expect(changes).toHaveLength(0);
  });
});
