// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import { moveSegmentInSequence } from "../src/editing/block-commands";
import { caretOffsetIn } from "../src/editing/dom-offset";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The wrapper element of the block. */
function wrapperOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  expect(el, `the block ${id} should be rendered`).not.toBeNull();
  return el!;
}

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const inner = wrapperOf(id).querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/** The total number of blocks in the doc. */
function blockCount(doc: TestDoc): number {
  return Object.keys(doc.toJSON().blocks).length;
}

/**
 * Dispatch a keydown on the wrapper; false when the handler suppressed the
 * event (dispatchEvent returns false after preventDefault).
 */
function key(wrapper: HTMLElement, name: string, init: KeyboardEventInit = {}): boolean {
  let result = true;
  act(() => {
    result = wrapper.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
    );
  });
  return result;
}

/**
 * Place the DOM caret at the flat character offset in the block's inner
 * editable (walking the text nodes across the run inlines).
 */
function caretAtFlat(id: BlockId, offset: number): void {
  const inner = innerOf(id);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (const child of Array.from(inner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.nodeValue?.length ?? 0;
      nodes.push({ node: child as Text, start: pos, end: pos + length });
      pos += length;
    }
  }
  const at = nodes.find((n) => offset >= n.start && offset <= n.end);
  expect(at, `a text node should cover offset ${offset}`).toBeDefined();
  const range = document.createRange();
  range.setStart(at!.node, offset - at!.start);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Flush the frame callbacks a gesture schedules (the focus move). */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("Enter: block split", () => {
  it("splits a paragraph mid-text and the tail keeps its mark", async () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "helloworld");
      d.setMark(p, 5, 10, { type: "bold" });
    });
    const before = blockCount(doc);
    const rootId = doc.meta.id;

    caretAtFlat(p, 5);
    key(wrapperOf(p), "Enter");

    const ids = doc.getChildren(rootId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(p);
    const tailId = ids[1]!;
    expect(doc.getText(p)).toBe("hello");
    expect(doc.getText(tailId)).toBe("world");
    expect(doc.getRuns(tailId)).toEqual([{ text: "world", marks: { bold: true } }]);

    // The store rebuilds the DOM: the tail block renders the bold run, and
    // the caret lands at its start (the gesture's DOM-only focus move).
    await flushFrames();
    expect(innerOf(tailId).querySelector("strong")?.textContent).toBe("world");
    const sel = window.getSelection()!;
    expect(innerOf(tailId).contains(sel.anchorNode)).toBe(true);
    expect(sel.anchorOffset).toBe(0);

    // One undo step restores the single block with the full text and mark.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(blockCount(doc)).toBe(before);
    expect(doc.getRuns(p)).toEqual([
      { text: "hello", marks: {} },
      { text: "world", marks: { bold: true } },
    ]);
    expect(innerOf(p).textContent).toBe("helloworld");
  });

  it("keeps the heading level when splitting", () => {
    let h: BlockId = "";
    const doc = renderDoc((d) => {
      h = d.insertBlock("heading", { level: 2 });
      d.insertText(h, 0, "ab");
    });

    caretAtFlat(h, 1);
    key(wrapperOf(h), "Enter");

    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    const second = doc.toJSON().blocks[ids[1]!];
    expect(second).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(doc.getText(ids[0]!)).toBe("a");
    expect(doc.getText(ids[1]!)).toBe("b");
  });

  it("exits an empty list item: the item is removed and a paragraph inserted after", () => {
    let intro: BlockId = "";
    let li: BlockId = "";
    const doc = renderDoc((d) => {
      intro = d.insertBlock("paragraph");
      d.insertText(intro, 0, "intro");
      li = d.insertBlock("list-item", { list: "bullet" });
    });

    // The empty item has no text node: the caret is the element offset 0.
    const inner = innerOf(li);
    const range = document.createRange();
    range.setStart(inner, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    expect(doc.getBlock(li)).toBeNull();
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(intro);
    const exit = doc.toJSON().blocks[ids[1]!];
    expect(exit).toMatchObject({ type: "paragraph" });
    expect(doc.getText(ids[1]!)).toBe("");

    // One undo step restores the list item.
    act(() => {
      doc.undo();
    });
    expect(doc.getBlock(li)).not.toBeNull();
    expect(doc.getBlock(li)!.type).toBe("list-item");
  });

  it("exits an empty list item at the sequence's start: the paragraph takes the item's former position", () => {
    let li: BlockId = "";
    let after: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      after = d.insertBlock("paragraph");
      d.insertText(after, 0, "after");
    });

    const innerEl = innerOf(li);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    // The item is the sequence's first block: there is no predecessor to
    // anchor on, so the paragraph takes the item's own slot (the sequence's
    // start) — not the sequence's end.
    expect(doc.getBlock(li)).toBeNull();
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "paragraph" });
    expect(ids[1]).toBe(after);

    // One undo step restores the list item at the start.
    act(() => {
      doc.undo();
    });
    expect(doc.getChildren(doc.meta.id)[0]).toBe(li);
  });

  it("exits an empty list item at the sequence's start with a sublist: the sublist goes with the removal", () => {
    let li: BlockId = "";
    let child: BlockId = "";
    let after: BlockId = "";
    const doc = renderDoc((d) => {
      li = d.insertBlock("list-item", { list: "bullet" });
      child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      after = d.insertBlock("paragraph");
    });

    const innerEl = innerOf(li);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(li), "Enter");

    // The item's sublist is removed with the removal (the composed landing
    // must not break the item's derived segment), and the paragraph takes
    // the item's own slot (the following block stands after it).
    expect(doc.getBlock(li)).toBeNull();
    expect(doc.getBlock(child)).toBeNull();
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(doc.toJSON().blocks[ids[0]!]).toMatchObject({ type: "paragraph" });
    expect(ids[1]).toBe(after);
  });

  it("exits a nested empty list item (depth 2): the paragraph lands at the item's attach level", () => {
    let outer: BlockId = "";
    let inner: BlockId = "";
    const doc = renderDoc((d) => {
      outer = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(outer, 0, "outer");
      inner = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    });

    const innerEl = innerOf(inner);
    const range = document.createRange();
    range.setStart(innerEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(inner), "Enter");

    // The markdown exit: the item is removed and the paragraph lands at
    // the item's attach level (indent - 1, the outer item's level), right
    // after the preceding block.
    expect(doc.getBlock(inner)).toBeNull();
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(outer);
    expect(doc.toJSON().blocks[ids[1]!]).toMatchObject({ type: "paragraph" });
  });

  it("exits a doubly-nested empty list item (depth 3): one level shallower, the rest stands", () => {
    let top: BlockId = "";
    let mid: BlockId = "";
    let deep: BlockId = "";
    const doc = renderDoc((d) => {
      top = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(top, 0, "top");
      mid = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      deep = d.insertBlock("list-item", { list: "bullet", indent: 2 });
    });

    const deepEl = innerOf(deep);
    const range = document.createRange();
    range.setStart(deepEl, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    key(wrapperOf(deep), "Enter");

    // The exit is one level: the paragraph lands at the item's attach level
    // (indent 1, the middle item's level) right after the preceding block —
    // the top-level list and the middle item stand.
    expect(doc.getBlock(deep)).toBeNull();
    const ids = doc.getChildren(doc.meta.id);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(top);
    expect(ids[1]).toBe(mid);
    const exitJson = doc.toJSON().blocks[ids[2]!]!;
    expect(exitJson).toMatchObject({ type: "paragraph" });
    expect((exitJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });

  it("is a no-op over an in-block range selection", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });
    const before = blockCount(doc);
    const inner = innerOf(p);
    const textNode = inner.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 3);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    const prevented = key(wrapperOf(p), "Enter");

    expect(prevented).toBe(false); // the browser line split is still suppressed
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(p)).toBe("hello");
  });
});

describe("Backspace: block merge", () => {
  it("merges into the previous paragraph and keeps the marks", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "ab");
      d.setMark(p1, 0, 1, { type: "bold" });
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "cd");
    });

    caretAtFlat(p2, 0);
    key(wrapperOf(p2), "Backspace");

    expect(doc.getBlock(p2)).toBeNull();
    expect(doc.getText(p1)).toBe("abcd");
    expect(doc.getRuns(p1)).toEqual([
      { text: "a", marks: { bold: true } },
      { text: "bcd", marks: {} },
    ]);

    // The caret lands at the join point (the previous block's old length),
    // measured flat across the run inlines.
    await flushFrames();
    const sel = window.getSelection()!;
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(innerOf(p1), sel.anchorNode!, sel.anchorOffset)).toBe(2);
  });

  it("removes a non-text previous sibling instead of merging", () => {
    let dividerId: BlockId = "";
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      dividerId = d.insertBlock("divider");
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });

    caretAtFlat(p, 0);
    key(wrapperOf(p), "Backspace");

    expect(doc.getBlock(dividerId)).toBeNull();
    expect(doc.getBlock(p)).not.toBeNull();
    expect(doc.getText(p)).toBe("x");
  });

  it("is a no-op when the current block is inside the previous block's segment (no data loss)", () => {
    // a / divider / x(indent 1): x sits inside the divider's derived
    // segment (the divider is x's attach parent). The old non-text branch
    // removed the divider's segment — which includes x — deleting its text
    // and re-seating the caret on the removed block. The merge is a no-op:
    // the caret stands, nothing is deleted, no doc write.
    let dividerId: BlockId = "";
    let x: BlockId = "";
    const doc = renderDoc((d) => {
      const a = d.insertBlock("paragraph");
      d.insertText(a, 0, "a");
      dividerId = d.insertBlock("divider");
      x = d.insertBlock("paragraph", { indent: 1 });
      d.insertText(x, 0, "x");
    });
    const before = blockCount(doc);
    const canUndoBefore = doc.canUndo;

    caretAtFlat(x, 0);
    const prevented = key(wrapperOf(x), "Backspace");

    // Not suppressed: the gesture found no merge (the browser default on a
    // collapsed caret at the block start is itself a no-op).
    expect(prevented).toBe(true);
    expect(blockCount(doc)).toBe(before);
    expect(doc.getBlock(dividerId)).not.toBeNull();
    expect(doc.getBlock(x)).not.toBeNull();
    expect(doc.getText(x)).toBe("x");
    expect(doc.canUndo).toBe(canUndoBefore); // no doc write
  });

  it("is a no-op on the first root block", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
    });
    const before = blockCount(doc);

    caretAtFlat(p, 0);
    const prevented = key(wrapperOf(p), "Backspace");

    expect(prevented).toBe(true); // not suppressed: the browser default runs
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(p)).toBe("x");
  });
});

describe("Segment move: the derived subtree as one contiguous range", () => {
  it("moves a segment past a shallower boundary to the end (the head-first landing commits)", () => {
    // A(0), B(1), C(2), D(0), E(0): the segment [B, C] (B is the head)
    // moves past the shallower boundary D/E to the end. A backwards move
    // (deepest first) lands C(2) after E(0) mid-transact — an indent jump
    // the core rejects and rolls back, dropping a valid gesture — while the
    // final [A, D, E, B, C] is valid.
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const root = doc.meta.id;
    const a = doc.insertBlock("paragraph");
    doc.insertText(a, 0, "a");
    const b = doc.insertBlock("paragraph", { indent: 1 });
    doc.insertText(b, 0, "b");
    const c = doc.insertBlock("paragraph", { indent: 2 });
    doc.insertText(c, 0, "c");
    const d = doc.insertBlock("paragraph");
    doc.insertText(d, 0, "d");
    const e = doc.insertBlock("paragraph");
    doc.insertText(e, 0, "e");

    // The segment [B, C] = indices 1..2 (start 1, length 2); the target is
    // the sequence's length (move to the end, nothing preceded).
    const ok = moveSegmentInSequence(doc, root, 1, 2, 5);

    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([a, d, e, b, c]);
    // A reorder, not a re-nest: the indents stand and the doc still
    // validates strictly (the jump rule holds over the whole sequence).
    expect(validateDoc(doc.toJSON())).toEqual([]);
    const bJson = doc.toJSON().blocks[b]!;
    const cJson = doc.toJSON().blocks[c]!;
    expect((bJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((cJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);

    // One undo step restores the original order.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(doc.getChildren(root)).toEqual([a, b, c, d, e]);
  });
});
