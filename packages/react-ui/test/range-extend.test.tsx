// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId, Selection as CoreSelection } from "docblocks-core";

import { Editor } from "../src/Editor";
import { applyDomSelection, extendSelectionTo } from "../src/editing/block-commands";
import { extendRangeFocusEnd } from "../src/editing/range-extend";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-11-11T00:00:00.000Z";
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

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const inner = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
  expect(inner, "the block should carry the inner editable").not.toBeNull();
  return inner!;
}

/** The block's text node (the test docs carry one unmarked run per block). */
function textNodeOf(id: BlockId): Text {
  const node = innerOf(id).firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/** A cross range (a, aOffset) → (b, bOffset) in document order. */
function crossRange(a: BlockId, aOffset: number, b: BlockId, bOffset: number): Range {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  return range;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe("applyDomSelection (the cross-editable stand)", () => {
  it("stands a cross-editable range (the anchor/focus API cannot)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one world");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "another world");
    });
    applyDomSelection(textNodeOf(p1), 1, textNodeOf(p2), 0);
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(textNodeOf(p1));
    expect(range.startOffset).toBe(1);
    expect(range.endContainer).toBe(textNodeOf(p2));
    expect(range.endOffset).toBe(0);
  });

  it("stands the backward input document-ordered (the probe stand)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one world");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "another world");
    });
    // The base is the document-order-last position: the range stands from
    // the earlier to the later, whatever the input's order.
    applyDomSelection(textNodeOf(p2), 3, textNodeOf(p1), 1);
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(textNodeOf(p1));
    expect(range.startOffset).toBe(1);
    expect(range.endContainer).toBe(textNodeOf(p2));
    expect(range.endOffset).toBe(3);
  });
});

describe("extendSelectionTo (the cross edge's extension)", () => {
  it("crosses into the target block's inner (the webkit's stand)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one world");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "another world");
    });
    extendSelectionTo(textNodeOf(p1), 0, p2, 0);
    const range = window.getSelection()!.getRangeAt(0);
    expect(range.startContainer).toBe(textNodeOf(p1));
    expect(range.startOffset).toBe(0);
    // The target's seat may stand on the inner element's own offset 0
    // (before the first child) — the logical point is the same.
    const endEl = range.endContainer.nodeType === Node.ELEMENT_NODE ? (range.endContainer as Element) : range.endContainer.parentElement;
    expect(endEl).toBe(innerOf(p2));
    expect(range.endOffset).toBe(0);
  });
});

describe("extendRangeFocusEnd (the clamped focus's stand)", () => {
  it("moves the far end when the focus reads back clamped in the anchor's editable", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one world");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "another world");
    });
    const a = textNodeOf(p1);
    const b = textNodeOf(p2);
    const range = crossRange(p1, 0, p2, 1);
    const real = window.getSelection()!;
    real.removeAllRanges();
    real.addRange(range);
    // The webkit's clamped read-back: the anchor/focus stand in the anchor's
    // own editable (the range carries the far endpoint); the write forwards
    // to the real selection.
    const clamped = {
      anchorNode: a,
      anchorOffset: 0,
      focusNode: a,
      focusOffset: 9,
      rangeCount: 1,
      getRangeAt: () => range,
      removeAllRanges: () => real.removeAllRanges(),
      addRange: (r: Range) => real.addRange(r),
    } as unknown as Selection;
    vi.spyOn(window, "getSelection").mockReturnValue(clamped);
    const selection: CoreSelection = {
      kind: "text",
      from: { blockId: p1, offset: 0 },
      to: { blockId: p2, offset: 1 },
    };
    expect(extendRangeFocusEnd(doc, selection, "ArrowRight")).toBe(true);
    const written = real.getRangeAt(0);
    expect(written.startContainer).toBe(a);
    expect(written.startOffset).toBe(0);
    expect(written.endContainer).toBe(b);
    expect(written.endOffset).toBe(2);
  });
});
