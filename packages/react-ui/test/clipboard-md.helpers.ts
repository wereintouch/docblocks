// The applyMdPaste test's shared stand: the fresh doc's seat (one
// paragraph), the root blocks' read (the type / the text / the attrs),
// the content's read, the single-block paste's result, and the non-root
// parent's read.
import { expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { Block, BlockId, Doc } from "docblocks-core";

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

export { CREATED_AT, contentOf, docWithParagraph, one, rootBlocks, rootBlocksOf, singleOf };
