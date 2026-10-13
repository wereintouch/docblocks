// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { type BlockId, createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** Two seeded paragraphs ("alpha" / "beta"), rendered in the base editor. */
function renderDoc(): { doc: TestDoc; a: BlockId; b: BlockId } {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const a = doc.insertBlock("paragraph");
  const b = doc.insertBlock("paragraph");
  doc.insertText(a, 0, "alpha");
  doc.insertText(b, 0, "beta");
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return { doc, a, b };
}

/** The inner contenteditable of the block. */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
  expect(el, `the inner of block ${id} should be rendered`).not.toBeNull();
  return el!;
}

/**
 * The caret resolution is stubbed through a registry: the pointerdown/move
 * coordinates are irrelevant, the test names the block the pointer "stands
 * in" (and the offset in it) before each dispatch. A pointer outside any
 * block resolves to null (the geometric fallback needs layout boxes, which
 * jsdom does not have).
 */
function stubCaret() {
  let target: BlockId | null = null;
  let offset = 0;
  document.caretRangeFromPoint = (x: number, y: number) => {
    void x;
    void y;
    if (target === null) return null;
    const inner = innerOf(target);
    // The inner's first text node (the seeded text runs are plain text
    // nodes in the test docs).
    const textNode = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT).nextNode();
    if (textNode === null) return null;
    const range = document.createRange();
    range.setStart(textNode, Math.min(offset, textNode.nodeValue?.length ?? 0));
    range.collapse(true);
    return range;
  };
  return {
    seatIn(id: BlockId, atOffset: number) {
      target = id;
      offset = atOffset;
    },
    clear() {
      target = null;
    },
  };
}

function pointerDown(target: Element, pointerId = 1) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", {
        pointerId,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        bubbles: true,
        cancelable: true,
      })
    );
  });
}

function pointerMove(pointerId = 1) {
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        bubbles: true,
      })
    );
  });
}

function pointerUp(pointerId = 1) {
  act(() => {
    window.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId,
        pointerType: "mouse",
        clientX: 0,
        clientY: 0,
        bubbles: true,
      })
    );
  });
}

/** The live DOM selection endpoints as (block id, offset) pairs. */
function domSelection(): { start: [BlockId, number]; end: [BlockId, number]; collapsed: boolean } | null {
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const blockOf = (node: Node): BlockId => {
    const el = node instanceof Element ? node : node.parentElement;
    return (el?.closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? "") as BlockId;
  };
  return {
    start: [blockOf(range.startContainer), range.startOffset],
    end: [blockOf(range.endContainer), range.endOffset],
    collapsed: selection.isCollapsed,
  };
}

afterEach(() => {
  cleanup();
  // The stub is a property assignment (jsdom's document takes it); an
  // undefined value stands for the unimplemented method.
  document.caretRangeFromPoint = undefined as unknown as typeof document.caretRangeFromPoint;
});

describe("the cross-drag selection session", () => {
  it("seats a cross-block selection from the pointer moves and keeps it over the pointerup", () => {
    const { a, b } = renderDoc();
    const caret = stubCaret();

    // Anchor at block a's end, drag into block b.
    caret.seatIn(a, 5);
    pointerDown(innerOf(a));
    caret.seatIn(b, 3);
    pointerMove();

    const during = domSelection()!;
    expect(during.collapsed).toBe(false);
    // The from/to stand in document order (block a first, block b last).
    const [startBlock, startOffset] = during.start;
    const [endBlock, endOffset] = during.end;
    expect([startBlock, startOffset]).toEqual([a, 5]);
    expect([endBlock, endOffset]).toEqual([b, 3]);

    // The release keeps the selection (the browser's own seat is
    // suppressed for the session's pointer).
    pointerUp();
    const after = domSelection()!;
    expect(after.collapsed).toBe(false);
    expect(after.start).toEqual([a, 5]);
    expect(after.end).toEqual([b, 3]);
  });

  it("seats the caret at the anchor on a click without a drag", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    caret.seatIn(a, 2);
    pointerDown(innerOf(a));
    pointerUp();

    const after = domSelection()!;
    expect(after.collapsed).toBe(true);
    expect(after.start).toEqual([a, 2]);
  });

  it("seats a reverse cross selection forward when the anchor stands at offset 0", () => {
    const { a, b } = renderDoc();
    const caret = stubCaret();

    // Anchor at block a's head (offset 0), drag back into... block b stands
    // after a, so the reverse case is anchored at b's head dragging to a:
    caret.seatIn(b, 0);
    pointerDown(innerOf(b));
    caret.seatIn(a, 1);
    pointerMove();

    const during = domSelection()!;
    expect(during.collapsed).toBe(false);
    // The degenerate reverse case is seated forward: the base stands at
    // the earlier endpoint (block a), the focus at the anchor (block b).
    expect(during.start[0]).toBe(a);
    expect(during.start[1]).toBe(1);
    expect(during.end[0]).toBe(b);
    expect(during.end[1]).toBe(0);
    pointerUp();
  });

  it("ignores the pointerdown outside a text inner (no session, no seat)", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    // A pointerdown on the block wrapper (the marker gutter area): no
    // session stands, and the moves seat nothing.
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${a}"]`)!;
    window.getSelection()?.removeAllRanges();
    caret.seatIn(a, 0);
    pointerDown(wrapper);
    pointerMove();
    expect(domSelection()).toBeNull();

    pointerUp();
    caret.clear();
    // No session is active any more: a second drag is possible (an
    // in-block range this time: the anchor at the head, the pointer two
    // characters in).
    caret.seatIn(a, 0);
    pointerDown(innerOf(a));
    caret.seatIn(a, 2);
    pointerMove();
    const second = domSelection()!;
    expect(second.collapsed).toBe(false);
    expect(second.start).toEqual([a, 0]);
    expect(second.end).toEqual([a, 2]);
    pointerUp();
  });
});
