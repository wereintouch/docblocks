import { describe, expect, it } from "vitest";

import { type BlockId, type Selection, createDoc } from "docblocks-core";

import { crossRangeClipboardContent } from "../src/editing/cross-copy";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Two seeded paragraphs: block a (bold "hello " + plain "world"), block b (plain "an" + italic "other"). */
function twoBlocks(doc: TestDoc): { a: BlockId; b: BlockId } {
  const a = doc.insertBlock("paragraph");
  const b = doc.insertBlock("paragraph");
  doc.insertText(a, 0, "hello ", { bold: true });
  doc.insertText(a, 6, "world");
  doc.insertText(b, 0, "an");
  doc.insertText(b, 2, "other", { italic: true });
  return { a, b };
}

function crossSelection(a: BlockId, aOffset: number, b: BlockId, bOffset: number): Selection {
  return { kind: "text", from: { blockId: a, offset: aOffset }, to: { blockId: b, offset: bOffset }, blocks: [a, b] };
}

describe("crossRangeClipboardContent", () => {
  it("serializes the covered segments of each chain block (partial endpoints)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    // (a, 6) to (b, 4): block a keeps its plain tail "world", block b is
    // cut after "an" + the first two italic letters "ot".
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 6, b, 4));
    expect(payload?.text).toBe("world\nanot");
    expect(payload?.html).toBe(`<div>world</div><div>an<em>ot</em></div>`);
  });

  it("covers a fully-covered head block in full", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 0, b, 2));
    expect(payload?.text).toBe("hello world\nan");
    expect(payload?.html).toBe(`<div><strong>hello </strong>world</div><div>an</div>`);
  });

  it("escapes the run text and the link href", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    doc.unsetMark(a, 0, 6, "bold");
    doc.setMark(a, 6, 11, { type: "link", href: "https://x.dev/?a=1&b=2" });
    const payload = crossRangeClipboardContent(doc, crossSelection(a, 6, b, 2));
    expect(payload?.html).toBe(`<div><a href="https://x.dev/?a=1&amp;b=2">world</a></div><div>an</div>`);
  });

  it("keeps the default copy for same-block ranges and carets", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    expect(
      crossRangeClipboardContent(doc, {
        kind: "text",
        from: { blockId: a, offset: 0 },
        to: { blockId: a, offset: 3 },
        blocks: [a],
      })
    ).toBeNull();
    expect(
      crossRangeClipboardContent(doc, { kind: "text", from: { blockId: a, offset: 0 }, to: null, blocks: [a] })
    ).toBeNull();
    expect(crossRangeClipboardContent(doc, { kind: "blocks", ids: [a, b], anchorId: a })).toBeNull();
    expect(crossRangeClipboardContent(doc, { kind: "none" })).toBeNull();
  });

  it("stands an empty segment for a non-text chain block (a skipped divider)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const { a, b } = twoBlocks(doc);
    const divider = doc.insertBlock("divider");
    // The chain order: a, divider, b (the divider stands between them).
    const selection: Selection = {
      kind: "text",
      from: { blockId: a, offset: 0 },
      to: { blockId: b, offset: 2 },
      blocks: [a, divider, b],
    };
    const payload = crossRangeClipboardContent(doc, selection);
    expect(payload?.text).toBe("hello world\n\nan");
    expect(payload?.html).toBe(`<div><strong>hello </strong>world</div><div></div><div>an</div>`);
  });
});
