/**
 * The multi-block markdown paste (the text/plain branch): the demotion in
 * a table-cell target (the target-ineligible blocks), the indent re-base,
 * the TO-side landing (the displaced block), and the one-transact undo.
 */
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block, BlockId, Doc } from "docblocks-core";

import { applyMdPaste } from "../src/editing/clipboard";
import { CREATED_AT, docWithParagraph, rootBlocks, rootBlocksOf } from "./clipboard-md.helpers";

describe("applyMdPaste: the demotion (the target-ineligible blocks)", () => {
  /** A doc with a 1x1 table; the seat is a paragraph inside the cell. */
  function cellSeat(): { doc: Doc; seat: BlockId; cellId: BlockId } {
    const doc = createDoc({ id: "doc-clip-md-cell", createdAt: CREATED_AT });
    doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: undefined });
    const tableId = doc.insertBlock(
      "table",
      { cols: 1 },
      { parent: doc.meta.id, after: doc.getChildren(doc.meta.id)[0]! }
    );
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const seat = doc.insertBlock("paragraph", undefined, { parent: cellId });
    return { doc, seat, cellId };
  }

  it("the list demotes to a paragraph inside a cell (the text and the marks stand)", () => {
    const { doc, seat, cellId } = cellSeat();
    applyMdPaste(doc, seat, 0, 0, "- **bold** item");
    const children = rootBlocksOf(doc, cellId);
    expect(children.map((b) => b.type)).toEqual(["paragraph"]);
    const runs = (doc.getBlock(children[0]!.id) as Extract<Block, { type: "paragraph" }>).content;
    expect(runs).toEqual([
      { text: "bold", marks: { bold: true } },
      { text: " item", marks: {} },
    ]);
  });

  it("the table demotes to the row-paragraphs inside a cell (the ` | ` join)", () => {
    const { doc, seat, cellId } = cellSeat();
    applyMdPaste(doc, seat, 0, 0, "| a | b |\n| --- | --- |\n| 1 | 2 |");
    const children = rootBlocksOf(doc, cellId);
    expect(children.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(children.map((b) => b.text)).toEqual(["a | b", "1 | 2"]);
  });
});

describe("applyMdPaste: the indent re-base", () => {
  it("a paste into a nested seat nests (the jump rule stands)", () => {
    const doc = createDoc({ id: "doc-clip-md-indent", createdAt: CREATED_AT });
    const top = doc.insertBlock("list-item", { list: "bullet" });
    const nested = doc.insertBlock("list-item", { list: "bullet", indent: 1 }, { parent: doc.meta.id, after: top });
    const landing = applyMdPaste(doc, nested, 0, 0, "text\n- item");
    const blocks = rootBlocks(doc);
    // the re-base: the top-level paste text nests under the nested seat
    // (the seat converts to a paragraph at its own indent)
    expect(blocks.map((b) => [b.type, b.attrs.indent ?? 0])).toEqual([
      ["list-item", 0],
      ["paragraph", 1],
      ["list-item", 1],
    ]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[2], offset: 4 });
  });
});

describe("applyMdPaste: the TO-side landing (the displaced block)", () => {
  it("a shallower tail lands after the seat's segment (the displaced follower is not dangled)", () => {
    const doc = createDoc({ id: "doc-clip-md-toside", createdAt: CREATED_AT });
    const top = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(top, 0, "top");
    const seat = doc.insertBlock("list-item", { list: "bullet", indent: 1 }, { parent: doc.meta.id, after: top });
    const child = doc.insertBlock("list-item", { list: "bullet", indent: 2 }, { parent: doc.meta.id, after: seat });
    doc.insertText(child, 0, "child");
    // The re-base (delta 0): the first block merges into the seat; the
    // tail paragraph (indent 0) would dangle the follower (2 > 0 + 1) —
    // it lands after the segment instead (the paste never writes an
    // invalid sequence).
    const landing = applyMdPaste(doc, seat, 0, 0, "  - x\ny");
    const blocks = rootBlocks(doc);
    expect(blocks.map((b) => [b.type, b.attrs.indent ?? 0, b.text])).toEqual([
      ["list-item", 0, "top"],
      ["list-item", 1, "x"],
      ["list-item", 2, "child"],
      ["paragraph", 0, "y"],
    ]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[3], offset: 1 });
  });

  it("the tail slides past a multi-block stretch (the doc stands valid)", () => {
    const doc = createDoc({ id: "doc-clip-md-toside2", createdAt: CREATED_AT });
    const p = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(p, 0, "p");
    const q = doc.insertBlock("list-item", { list: "bullet", indent: 1 }, { parent: doc.meta.id, after: p });
    doc.insertText(q, 0, "q");
    const seat = doc.insertBlock("list-item", { list: "bullet", indent: 2 }, { parent: doc.meta.id, after: q });
    const c = doc.insertBlock("list-item", { list: "bullet", indent: 3 }, { parent: doc.meta.id, after: seat });
    doc.insertText(c, 0, "c");
    const d = doc.insertBlock("list-item", { list: "bullet", indent: 2 }, { parent: doc.meta.id, after: c });
    doc.insertText(d, 0, "d");
    // The re-based tail ("y" at indent 0) would dangle the stretch after
    // the seat (3 > 0 + 1, 2 > 0 + 1) — the landing slides past the whole
    // stretch to the sequence end.
    const landing = applyMdPaste(doc, seat, 0, 0, "    - x\ny");
    const blocks = rootBlocks(doc);
    expect(blocks.map((b) => [b.attrs.indent ?? 0, b.text])).toEqual([
      [0, "p"],
      [1, "q"],
      [2, "x"],
      [3, "c"],
      [2, "d"],
      [0, "y"],
    ]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[5], offset: 1 });
  });
});

describe("applyMdPaste: the one-transact undo", () => {
  it("the whole multi-block paste is one undo step", () => {
    const { doc, seat } = docWithParagraph("");
    const before = JSON.stringify(doc.toJSON());
    applyMdPaste(doc, seat, 0, 0, "# H\n\ntext\n\n- a\n- b\n\n```\ncode\n```");
    doc.undo();
    expect(JSON.stringify(doc.toJSON())).toBe(before);
    doc.undo(); // the seat paragraph's own creation
    expect(doc.getChildren(doc.meta.id)).toHaveLength(0);
  });

  it("the whitespace-only markdown is a no-op (the lenient posture)", () => {
    const { doc, seat } = docWithParagraph("keep");
    const landing = applyMdPaste(doc, seat, 0, 0, "   \n  \n");
    expect(landing).toBeNull();
    expect(rootBlocks(doc)[0]!.text).toBe("keep");
  });
});
