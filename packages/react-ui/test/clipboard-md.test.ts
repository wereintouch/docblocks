/**
 * The multi-block markdown paste (the text/plain branch): the applyMdPaste
 * integration over a real core Doc (no DOM). The pins: the block
 * materialization (the types, the attrs, the runs) and the caret-block
 * split (prefix/suffix, the selection's replace, the in-place conversion,
 * the non-text landing).
 */
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block, BlockId } from "docblocks-core";

import { applyMdPaste } from "../src/editing/clipboard";
import { CREATED_AT, contentOf, docWithParagraph, one, rootBlocks, singleOf } from "./clipboard-md.helpers";

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

  it("the GFM table lands with its column set (the separator row omitted)", () => {
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
    const rows = doc.getChildren(doc.meta.id);
    const tableId = rows[0]!;
    expect((doc.getBlock(tableId) as { columnOrder?: string[] }).columnOrder).toHaveLength(2);
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
