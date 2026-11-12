// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

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

function wrapperOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  expect(el, `the block ${id} should be rendered`).not.toBeNull();
  return el!;
}

function textNodeOf(id: BlockId): Text {
  const inner = wrapperOf(id).querySelector<HTMLElement>('[data-slot="docblocks/block-content"]')!;
  const node = inner.firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/** Select from (a, aOffset) to (b, bOffset) and sync the view selection (the
 * selectionchange mapping). */
function selectAcross(a: BlockId, aOffset: number, b: BlockId, bOffset: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function selectIn(a: BlockId, aOffset: number, bOffset: number | null): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  if (bOffset !== null) range.setEnd(textNodeOf(a), bOffset);
  else range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

/** The overlay's segment boxes. */
function segmentBoxes(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-slot="docblocks/selection-segment"]'));
}

/**
 * The engine's clamped read-back stand: the DOM selection's range crosses
 * the editables (the endpoints stand), but the anchor / focus read-backs
 * stand in the anchor's editable (the clamped engine's read). The crossing
 * engine stands the focus in the far editable (the natural jsdom stand).
 */
function standClampedReadBack(a: BlockId, b: BlockId, aOffset: number, bOffset: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  const anchorNode = textNodeOf(a);
  const fake = {
    rangeCount: 1,
    anchorNode,
    anchorOffset: aOffset,
    focusNode: anchorNode,
    focusOffset: aOffset,
    getRangeAt: () => range,
  } as unknown as Selection;
  vi.spyOn(window, "getSelection").mockReturnValue(fake);
}

const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the cross-selection overlay (the clamped engine's own-selection stand)", () => {
  it("draws the far block's segment over the clamped read-back and skips the anchor block", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;
    expect(segmentBoxes(root)).toHaveLength(0);

    // The cross selection (p1 -> p2) over the clamped read-back: the
    // engine's native highlight covers the anchor (p1) — the overlay draws
    // p2's segment only.
    selectAcross(p1, 1, p2, 2);
    standClampedReadBack(p1, p2, 1, 2);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root).map((box) => box.dataset.blockId)).toEqual([p2]);
  });

  it("stands no boxes over the crossing read-back (the native selection crosses)", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;

    // The natural jsdom stand: the focus read-back crosses (the crossing
    // engine's read) — the native highlight stands the full range.
    selectAcross(p1, 1, p2, 2);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root)).toHaveLength(0);
  });

  it("stands no boxes over a single-block range or a caret (the engine's stand)", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;

    selectIn(p1, 1, 4);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root)).toHaveLength(0);

    selectIn(p2, 2, null);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root)).toHaveLength(0);
  });

  it("clears the boxes when the selection leaves the cross range", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;

    selectAcross(p1, 1, p2, 2);
    standClampedReadBack(p1, p2, 1, 2);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root).map((box) => box.dataset.blockId)).toEqual([p2]);

    // A caret inside p2: the range's stand ends.
    vi.restoreAllMocks();
    selectIn(p2, 2, null);
    await act(async () => {
      await flushFrames();
    });
    expect(segmentBoxes(root)).toHaveLength(0);
  });
});
