// The cross-drag's split set's shared stand: the two seeded paragraphs'
// render, the inner's read, the caret's stub over the registry (the jsdom's
// layout-less stand — the test names the block the pointer stands in), the
// pointer / the mousedown's dispatch, the DOM selection's read, and the
// per-test cleanup (the stub's tear-down).
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { type BlockId, createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

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
  // deprecation-allow: the WebKit caret-range API the hook reads (Chrome / Safari).
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

/** A mousedown on `target` with the given click count (the event's own detail stands the real count). */
function mouseDown(target: Element, detail = 1): MouseEvent {
  const event = new MouseEvent("mousedown", { detail, button: 0, bubbles: true, cancelable: true });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
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
  // deprecation-allow: the WebKit caret-range API the hook reads (Chrome / Safari).
  document.caretRangeFromPoint = undefined as unknown as typeof document.caretRangeFromPoint;
});

export { domSelection, innerOf, mouseDown, pointerDown, pointerMove, pointerUp, renderDoc, stubCaret };
