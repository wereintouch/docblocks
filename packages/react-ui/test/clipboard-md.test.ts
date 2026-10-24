/**
 * The multi-block markdown paste (the text/plain branch): the applyMdPaste
 * integration over a real core Doc (no DOM). The pins: the block
 * materialization (the types, the attrs, the runs), the caret-block split
 * (prefix/suffix), the empty-block in-place conversion, the code target
 * (raw text), the cross-seam landing, the demotion in a
 * table-cell target, the indent re-base, the one-transact undo (one undo
 * step over the whole paste), and the inline html tags (the unified pass
 * over the real doc).
 */
import { describe, expect, it } from "vitest";

import type { Block, BlockId, Doc } from "docblocks-core";
import { createDoc } from "docblocks-core";

import { applyMdPaste } from "../src/editing/clipboard";

const CREATED_AT = "2026-10-16T00:00:00.000Z";

/** A fresh doc with one paragraph ("hello") as the paste seat. */
function docWithParagraph(text = "hello"): { doc: Doc; seat: BlockId } {
  const doc = createDoc({ id: "doc-clip-md", createdAt: CREATED_AT });
  const seat = doc.insertBlock("paragraph");
  if (text !== "") doc.insertText(seat, 0, text);
  return { doc, seat };
}

/** The root children as (type, text) pairs (the text via the store-free read). */
function rootBlocks(doc: Doc): { type: string; text: string; attrs: Record<string, unknown> }[] {
  return doc.getChildren(doc.meta.id).map((id) => {
    const block = doc.getBlock(id)!;
    const text =
      "content" in block ? (block as { content: { text: string }[] }).content.map((r) => r.text).join("") : "";
    return { type: block.type, text, attrs: attrsOf(block) };
  });
}

function contentOf(doc: Doc, id: BlockId): string {
  const block = doc.getBlock(id)!;
  return ("content" in block ? (block as { content: { text: string }[] }).content : []).map((r) => r.text).join("");
}

function attrsOf(block: Block): Record<string, unknown> {
  return ("attrs" in block ? ((block as { attrs?: unknown }).attrs ?? {}) : {}) as Record<string, unknown>;
}

function singleOf(blocks: { type: string; text: string; attrs: Record<string, unknown> }[]): {
  type: string;
  text: string;
  attrs: Record<string, unknown>;
} {
  expect(blocks.length).toBe(1);
  return blocks[0]!;
}

/** The single-block paste result (the length pinned). */
function one(
  markdown: string,
  text = ""
): { doc: Doc; seat: BlockId; block: { type: string; text: string; attrs: Record<string, unknown> } } {
  const { doc, seat } = docWithParagraph(text);
  applyMdPaste(doc, seat, 0, 0, markdown);
  const blocks = rootBlocks(doc);
  expect(blocks.length).toBe(1);
  return { doc, seat, block: blocks[0]! };
}

describe("applyMdPaste: the block materialization", () => {
  it("a heading + paragraph + list lands as three native blocks (the empty seat converts)", () => {
    const { doc, seat } = docWithParagraph("");
    const landing = applyMdPaste(doc, seat, 0, 0, "# H\n\ntext\n\n- item");
    const blocks = rootBlocks(doc);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "list-item"]);
    expect(blocks[0]!.attrs).toMatchObject({ level: 1 });
    expect(blocks[2]!.attrs).toMatchObject({ list: "bullet" });
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[2], offset: 4 });
  });

  it("the paragraph soft break is a space, the hard break a \\n", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "a b\nc  d\ne  f  \ng");
    const blocks = rootBlocks(doc);
    expect(blocks.map((b) => b.text)).toEqual(["a b c  d e  f\ng"]);
  });

  it("the GFM table lands with the required cols attr (the separator row omitted)", () => {
    const { doc, seat } = docWithParagraph("");
    const landing = applyMdPaste(doc, seat, 0, 0, "| a | **b** |\n| --- | --- |\n| 1 | 2 |");
    const blocks = rootBlocks(doc);
    // the empty seat is replaced by the table (the trailing paragraph: the
    // non-text landing at the sequence end); the caret seats in the trailing
    // paragraph (the sibling after the last pasted block)
    expect(blocks.map((b) => b.type)).toEqual(["table", "paragraph"]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[1], offset: 0 });
    const table = blocks[0]!;
    expect(table.type).toBe("table");
    expect(table.attrs.cols).toBe(2);
    const rows = doc.getChildren(doc.meta.id);
    const tableId = rows[0]!;
    const rowIds = doc.getChildren(tableId);
    expect(rowIds).toHaveLength(2);
    // A cell is a mini-doc: its text stands in a child paragraph (not the
    // cell's own content — the renderer draws the children sequence).
    const cellTexts = (rowId: BlockId): string[] =>
      doc.getChildren(rowId).map((cellId) => {
        const children = doc.getChildren(cellId);
        return children.length === 0 ? "" : contentOf(doc, children[0]!);
      });
    expect(cellTexts(rowIds[0]!)).toEqual(["a", "b"]);
    expect(cellTexts(rowIds[1]!)).toEqual(["1", "2"]);
    // the bold mark rides the cell paragraph's run
    const firstRowCells = doc.getChildren(rowIds[0]!);
    const bPara = doc.getChildren(firstRowCells[1]!)[0]!;
    const bRuns = (doc.getBlock(bPara)! as Extract<Block, { type: "paragraph" }>).content;
    expect(bRuns).toEqual([{ text: "b", marks: { bold: true } }]);
  });

  it("the $$ math degrades to the literal paragraph text", () => {
    const { block } = one("$$ x^2 $$");
    expect(block.type).toBe("paragraph");
    expect(block.text).toBe("$$ x^2 $$");
  });

  it("the standalone image lands with the src attr (verbatim)", () => {
    const { doc, seat } = docWithParagraph("");
    const landing = applyMdPaste(doc, seat, 0, 0, "![alt](https://x.com/img.png)");
    const blocks = rootBlocks(doc);
    // the non-text landing at the sequence end: the trailing paragraph stands
    expect(blocks.map((b) => b.type)).toEqual(["image", "paragraph"]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[1], offset: 0 });
    expect(blocks[0]!.attrs.src).toBe("https://x.com/img.png");
  });

  it("the thematic break lands as the divider", () => {
    const { doc, seat } = docWithParagraph("");
    const landing = applyMdPaste(doc, seat, 0, 0, "---");
    const blocks = rootBlocks(doc);
    // the empty seat converts in place; the trailing paragraph stands after
    // the non-text landing at the sequence end (the caret seats in it)
    expect(blocks.map((b) => b.type)).toEqual(["divider", "paragraph"]);
    expect(landing).toEqual({ blockId: doc.getChildren(doc.meta.id)[1], offset: 0 });
  });

  it("the task list lands with the checked attr", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "- [ ] open\n- [x] done");
    const blocks = rootBlocks(doc);
    expect(blocks[0]!.attrs).toMatchObject({ list: "task", checked: false });
    expect(blocks[1]!.attrs).toMatchObject({ list: "task", checked: true });
  });

  it("the fenced code lands with the language attr (the content verbatim)", () => {
    const { block } = one("```rust\nfn main() {}\n```");
    expect(block.type).toBe("code");
    expect(block.attrs).toMatchObject({ language: "rust" });
    expect(block.text).toBe("fn main() {}");
  });
});

describe("applyMdPaste: the caret-block split", () => {
  it("the prefix stands, the first block merges (same type), the suffix lands in the last block", () => {
    const { doc, seat } = docWithParagraph("Привет мир");
    // the caret after the space (offset 8)
    const landing = applyMdPaste(doc, seat, 7, 7, "X");
    const blocks = rootBlocks(doc);
    expect(singleOf(blocks).text).toBe("Привет Xмир");
    // the caret lands at the end of the pasted content (before the suffix)
    expect(landing).toEqual({ blockId: seat, offset: 8 });
  });

  it("the first block of a different type follows the seat (the prefix stands)", () => {
    const { doc, seat } = docWithParagraph("Привет мир");
    applyMdPaste(doc, seat, 7, 7, "# H\ntext");
    const blocks = rootBlocks(doc);
    expect(blocks[0]!.text).toBe("Привет ");
    expect(blocks[1]!.type).toBe("heading");
    // the suffix lands in the last text block (the pasted paragraph)
    expect(blocks[2]!.text).toBe("textмир");
  });

  it("the selection is replaced (the prefix + the paste + the suffix)", () => {
    const { doc, seat } = docWithParagraph("Привет мир");
    applyMdPaste(doc, seat, 7, 11, "X"); // the selection covers "мир"
    const blocks = rootBlocks(doc);
    expect(singleOf(blocks).text).toBe("Привет X");
  });

  it("the empty caret block converts in place (the block id stands)", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "## H");
    const blocks = rootBlocks(doc);
    const block = blocks[0]!;
    expect(block.type).toBe("heading");
    expect(block.attrs).toMatchObject({ level: 2 });
    expect(doc.getChildren(doc.meta.id)[0]).toBe(seat);
  });

  it("the non-text landing seats the caret in the next sibling (or the seat)", () => {
    const { doc, seat } = docWithParagraph("end");
    const next = doc.insertBlock("paragraph");
    doc.insertText(next, 0, "after");
    const landing = applyMdPaste(doc, seat, 0, 6, "---");
    // the selection empties the seat from 0 (it is removed); the divider
    // takes its slot; the landing seats in the next sibling
    expect(landing).toEqual({ blockId: next, offset: 0 });
    expect(rootBlocks(doc).map((b) => b.type)).toEqual(["divider", "paragraph"]);
  });

  it("the suffix lands in a trailing paragraph when the last block is not a paragraph", () => {
    const { doc, seat } = docWithParagraph("hello");
    applyMdPaste(doc, seat, 0, 3, "# H");
    const blocks = rootBlocks(doc);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
    expect(blocks[0]!.text).toBe("H");
    expect(blocks[1]!.text).toBe("lo");
  });

  it("the seat with a nested follower keeps its slot (the removeBlock cascade never fires)", () => {
    const doc = createDoc({ id: "doc-clip-md-seg", createdAt: CREATED_AT });
    const before = doc.insertBlock("paragraph");
    const seat = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: before });
    const follower = doc.insertBlock("paragraph", { indent: 1 }, { parent: doc.meta.id, after: seat });
    doc.insertText(follower, 0, "nested");
    const landing = applyMdPaste(doc, seat, 0, 0, "![alt](x)");
    const blocks = rootBlocks(doc);
    // the seat stands (its derived segment would be cascaded by the
    // removal); the image follows the seat; the follower stands
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph", "image", "paragraph"]);
    expect(blocks[3]!.text).toBe("nested");
    // the non-text landing: the sibling after the image (the follower)
    expect(landing).toEqual({ blockId: follower, offset: 0 });
  });
});

describe("applyMdPaste: the code target (the raw text)", () => {
  it("the code target takes the fence as data (no parsing, no new blocks)", () => {
    const { doc } = docWithParagraph("");
    const codeId = doc.insertBlock("code", { language: "md" });
    const landing = applyMdPaste(doc, codeId, 0, 0, "# not a heading\n- not a list\n```\n");
    expect(rootBlocks(doc).length).toBe(2); // the seat paragraph + the code
    expect(contentOf(doc, codeId)).toBe("# not a heading\n- not a list\n```\n");
    expect(landing).toEqual({ blockId: codeId, offset: 33 });
  });
});

describe("applyMdPaste: the inline html tags (the unified pass)", () => {
  it("the marks land over the doc (the heading span, the br break, the structural line literal)", () => {
    const { doc, seat } = docWithParagraph("");
    applyMdPaste(doc, seat, 0, 0, "# T <b>жирный</b>\n- пункт <br> дальше\n<p>литерал</p>");
    const [headingId, itemId, paraId] = doc.getChildren(doc.meta.id);
    const heading = doc.getBlock(headingId!) as unknown as {
      content: Array<{ text: string; marks: Record<string, unknown> }>;
    };
    expect(heading.content).toEqual([
      { text: "T ", marks: {} },
      { text: "жирный", marks: { bold: true } },
    ]);
    const item = doc.getBlock(itemId!) as unknown as { content: Array<{ text: string }> };
    expect(item.content.map((r) => r.text).join("")).toBe("пункт \n дальше");
    const para = doc.getBlock(paraId!) as unknown as { content: Array<{ text: string }> };
    expect(para.content.map((r) => r.text).join("")).toBe("<p>литерал</p>");
  });

  it("the code target takes the tags raw (no parsing)", () => {
    const { doc } = docWithParagraph("");
    const codeId = doc.insertBlock("code", { language: "html" });
    applyMdPaste(doc, codeId, 0, 0, "<b>не жирный</b>\n<p>не абзац</p>");
    expect(contentOf(doc, codeId)).toBe("<b>не жирный</b>\n<p>не абзац</p>");
  });
});

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

// ---- helpers (the non-root parent) ----

function rootBlocksOf(
  doc: Doc,
  parentId: BlockId
): { id: BlockId; type: string; text: string; attrs: Record<string, unknown> }[] {
  return doc.getChildren(parentId).map((id) => {
    const block = doc.getBlock(id)!;
    const text =
      "content" in block ? (block as { content: { text: string }[] }).content.map((r) => r.text).join("") : "";
    return { id, type: block.type, text, attrs: attrsOf(block) };
  });
}
