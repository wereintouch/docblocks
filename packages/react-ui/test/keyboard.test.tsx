// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId, Selection } from "docblocks-core";

import { Editor } from "../src/Editor";
import { caretOffsetIn } from "../src/editing/dom-offset";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { EditorContextValue } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

// Captures the context at render time; the selection handle is a stable
// ref object, so `.view` read later is the live event-time value.
let context: EditorContextValue | null = null;
function ContextCapture() {
  context = useEditorContext();
  return null;
}

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
      <ContextCapture />
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

/** The text nodes of the block's inner (document order, across run inlines), with flat ranges. */
function textNodesOf(id: BlockId): { node: Text; start: number; end: number }[] {
  const nodes: { node: Text; start: number; end: number }[] = [];
  const walker = document.createTreeWalker(innerOf(id), NodeFilter.SHOW_TEXT);
  let pos = 0;
  let current = walker.nextNode();
  while (current !== null) {
    const length = current.nodeValue?.length ?? 0;
    nodes.push({ node: current as Text, start: pos, end: pos + length });
    pos += length;
    current = walker.nextNode();
  }
  return nodes;
}

/** The flat position at a character offset (the text node covering it). */
function positionAt(id: BlockId, offset: number): { node: Text; offset: number } {
  const at = textNodesOf(id).find((n) => offset >= n.start && offset <= n.end);
  expect(at, `a text node should cover offset ${offset}`).toBeDefined();
  return { node: at!.node, offset: offset - at!.start };
}

/** Place the DOM caret at the flat character offset of the block's inner. */
function caretAtFlat(id: BlockId, offset: number): void {
  const at = positionAt(id, offset);
  const range = document.createRange();
  range.setStart(at.node, at.offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

/** Select the flat range [from, to) of the block's inner. */
function rangeAtFlat(id: BlockId, from: number, to: number): void {
  const start = positionAt(id, from);
  const end = positionAt(id, to);
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

/** Dispatch a keydown on the wrapper; false when the handler suppressed it. */
function key(wrapper: HTMLElement, init: KeyboardEventInit): boolean {
  let result = true;
  act(() => {
    result = wrapper.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
  return result;
}

/** Trigger the mapping of the current DOM selection into the core view. */
function fireSelectionChange(): void {
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** The core selection currently held by the view. */
function viewSelection(): Selection {
  expect(context).not.toBeNull();
  const view = context!.selection.view;
  expect(view, "the selection view should be live after mount").not.toBeNull();
  return view!.get();
}

/** Assert the view holds a collapsed caret at the block's flat offset. */
function expectCaret(blockId: BlockId, offset: number): void {
  const selection = viewSelection();
  expect(selection.kind).toBe("text");
  if (selection.kind !== "text") return;
  expect(selection.from).toEqual({ blockId, offset });
  expect(selection.to).toBeNull();
  expect(selection.reverse).toBeUndefined();
}

/** The local selection view (for setting a blocks selection). */
function setViewSelection(selection: Selection): void {
  act(() => {
    viewSelection(); // live-handle assertion
    context!.selection.view!.set(selection);
  });
}

/** Flush the frame callbacks a gesture schedules (the focus move). */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  cleanup();
  context = null;
  window.getSelection()?.removeAllRanges();
});

describe("cross-block arrow navigation", () => {
  it("ArrowUp at offset 0 moves the caret to the end of the previous block", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    caretAtFlat(p2, 0);
    const prevented = key(wrapperOf(p2), { key: "ArrowUp" });

    expect(prevented).toBe(false); // the browser default is suppressed
    await flushFrames();
    const inner1 = innerOf(p1);
    const sel = window.getSelection()!;
    expect(inner1.contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner1, sel.anchorNode!, sel.anchorOffset)).toBe(3);

    // The selectionchange mapping updates the view selection.
    fireSelectionChange();
    expectCaret(p1, 3);
  });

  it("ArrowDown at the text end moves the caret to the start of the next block", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    caretAtFlat(p1, 3);
    const prevented = key(wrapperOf(p1), { key: "ArrowDown" });

    expect(prevented).toBe(false);
    await flushFrames();
    const inner2 = innerOf(p2);
    const sel = window.getSelection()!;
    expect(inner2.contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner2, sel.anchorNode!, sel.anchorOffset)).toBe(0);
    fireSelectionChange();
    expectCaret(p2, 0);
  });

  it("skips a non-text sibling in both directions", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      d.insertBlock("divider");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    caretAtFlat(p2, 0);
    expect(key(wrapperOf(p2), { key: "ArrowUp" })).toBe(false);
    await flushFrames();
    expect(caretOffsetIn(innerOf(p1), window.getSelection()!.anchorNode!, window.getSelection()!.anchorOffset)).toBe(3);

    caretAtFlat(p1, 3);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(false);
    await flushFrames();
    expect(caretOffsetIn(innerOf(p2), window.getSelection()!.anchorNode!, window.getSelection()!.anchorOffset)).toBe(0);
  });

  it("is a no-op at the edges and for a mid-block caret", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // First block, offset 0: nothing above.
    caretAtFlat(p1, 0);
    expect(key(wrapperOf(p1), { key: "ArrowUp" })).toBe(true); // default runs
    fireSelectionChange();
    expectCaret(p1, 0);

    // Last block, text end: nothing below.
    caretAtFlat(p2, 3);
    expect(key(wrapperOf(p2), { key: "ArrowDown" })).toBe(true);
    fireSelectionChange();
    expectCaret(p2, 3);

    // Mid-block: the browser line-move default runs (single line: a no-op).
    caretAtFlat(p1, 1);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(true);
  });

  it("yields to a blocks selection: the plain arrows keep the selection navigation", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // The gutter flow: a blocks selection on p1 with a leftover DOM caret
    // at p1's text end. ArrowDown must move the SELECTION (input-safety),
    // not the caret (cross-block navigation).
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    caretAtFlat(p1, 3);
    const prevented = key(wrapperOf(p1), { key: "ArrowDown" });

    expect(prevented).toBe(false);
    const selection = viewSelection();
    expect(selection.kind).toBe("blocks");
    if (selection.kind === "blocks") expect(selection.ids).toEqual([p2]);
    // The caret gesture did not run: the DOM selection left p1 (the
    // selection navigation focuses the next wrapper) but did not land
    // inside p2's inner editable.
    const sel = window.getSelection()!;
    expect(innerOf(p1).contains(sel.anchorNode)).toBe(false);
    expect(innerOf(p2).contains(sel.anchorNode)).toBe(false);
  });

  it("ignores a range selection and an out-of-block caret", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // An in-block range is not a collapsed caret.
    rangeAtFlat(p1, 0, 1);
    expect(key(wrapperOf(p1), { key: "ArrowDown" })).toBe(true);

    // No DOM selection at all.
    window.getSelection()!.removeAllRanges();
    expect(key(wrapperOf(p1), { key: "ArrowUp" })).toBe(true);
  });
});

describe("mod+shift+arrow: block move", () => {
  it("moves the selected block down one slot; the selection follows", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "c");
    });

    // A single-block blocks selection held on p1 (the wrapper-focused gutter selection).
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    const prevented = key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    expect(prevented).toBe(false);
    expect(doc.getChildren(doc.meta.id)).toEqual([p2, p1, p3]);
    // The selection is blocks-kind by id — it survived the move and is re-set.
    expect(viewSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });
  });

  it("moves the selected block up one slot", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
    });

    setViewSelection({ kind: "blocks", ids: [p2], anchorId: p2 });
    expect(key(wrapperOf(p2), { key: "ArrowUp", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(doc.getChildren(doc.meta.id)).toEqual([p2, p1]);
    expect(viewSelection()).toEqual({ kind: "blocks", ids: [p2], anchorId: p2 });
  });

  it("clamps at the sibling edges and ignores a selection held elsewhere", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "a");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "b");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "c");
    });

    // Last block, ArrowDown: nothing to move into.
    setViewSelection({ kind: "blocks", ids: [p3], anchorId: p3 });
    expect(key(wrapperOf(p3), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // First block, ArrowUp: nothing to move into.
    setViewSelection({ kind: "blocks", ids: [p1], anchorId: p1 });
    expect(key(wrapperOf(p1), { key: "ArrowUp", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // A blocks selection held on another block: this wrapper is a no-op.
    setViewSelection({ kind: "blocks", ids: [p2], anchorId: p2 });
    expect(key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);

    // A text selection (no blocks selection): the gesture does not apply.
    setViewSelection({ kind: "text", from: { blockId: p1, offset: 0 }, to: null });
    expect(key(wrapperOf(p1), { key: "ArrowDown", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2, p3]);
  });
});

describe("format shortcuts", () => {
  it("mod+b bolds the selected range; a second mod+b unsets it; one undo step each", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    // Select "ell" (flat offsets 1..4) and bold it.
    rangeAtFlat(p, 1, 4);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "h", marks: {} },
      { text: "ell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);

    // The selection survived the store-driven change: the second mod+b over
    // the same range unsets the mark.
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);

    // One undo step per toggle.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(doc.getRuns(p)).toEqual([
      { text: "h", marks: {} },
      { text: "ell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);
    act(() => {
      doc.undo();
    });
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);
  });

  it("a partially bold range toggles to set", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
      d.setMark(p, 0, 3, { type: "bold" }); // "hel" bold, "lo" plain
    });

    // "ell" (flat offsets 1..4) is only partly bold: the toggle sets, and
    // the set extends over the whole range (the pre-bolded head keeps it).
    rangeAtFlat(p, 1, 4);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);
  });

  it("mod+shift+x strikes, and other marks follow the same shortcut scheme", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    rangeAtFlat(p, 0, 3);
    expect(key(wrapperOf(p), { key: "x", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hel", marks: { strike: true } },
      { text: "lo", marks: {} },
    ]);

    rangeAtFlat(p, 3, 5);
    expect(key(wrapperOf(p), { key: "i", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hel", marks: { strike: true } },
      { text: "lo", marks: { italic: true } },
    ]);
  });

  it("a collapsed caret is a no-op, with the default suppressed", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    caretAtFlat(p, 2);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false); // suppressed
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);
  });

  it("does not toggle marks over a selection outside the block", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // The selection sits in p2; the shortcut on the p1 wrapper is a no-op
    // (no marks applied) but suppresses the default so the browser's native
    // formatting cannot diverge the document DOM over the cross-block range.
    rangeAtFlat(p2, 0, 2);
    expect(key(wrapperOf(p1), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p2)).toEqual([{ text: "two", marks: {} }]);
  });
});
