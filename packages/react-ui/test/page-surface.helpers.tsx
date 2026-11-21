// The page-surface tests' shared stand: the jsdom's Range's rect's
// stub, the doc's render fixture, the editor's root's / the page's /
// the inner's reads, and the caret's seat (the element's position / the
// flat's offset) + the per-test's cleanup.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

/** jsdom's Range stands no getBoundingClientRect: the reseat's rect read
 *  falls back to the document order over the degenerate stand. */
function stubRangeRects(): void {
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect = () =>
      ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => null }) as DOMRect;
  }
}

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

/** The editor root element. */
function rootOf(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
  expect(root, "the editor root should be rendered").not.toBeNull();
  return root!;
}

/** The page container (the single editable of the edit mode). */
function pageOf(): HTMLElement {
  const page = rootOf().querySelector<HTMLElement>('[data-slot="docblocks/page"]');
  expect(page, "the page container should be rendered").not.toBeNull();
  return page!;
}

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
  expect(el, `the block ${id}'s inner should be rendered`).not.toBeNull();
  return el!;
}

/** Seat a collapsed DOM caret at the element position (the container's gap). */
function seatAtElement(el: HTMLElement, index: number): void {
  const range = document.createRange();
  range.setStart(el, index);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Seat a collapsed DOM caret at the block's flat character offset. */
function seatInInner(id: BlockId, offset: number): void {
  const inner = innerOf(id);
  const range = document.createRange();
  range.selectNodeContents(inner);
  range.setStart(inner, 0);
  // Walk the text nodes over the offset (the runs' inlines).
  let remaining = offset;
  let node: Node | null = inner.firstChild;
  while (node !== null && remaining > 0) {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.nodeValue?.length ?? 0;
      if (remaining <= length) {
        range.setStart(node, remaining);
        break;
      }
      remaining -= length;
    }
    node = node.nextSibling;
  }
  if (remaining === 0 && node !== null && node.nodeType === Node.TEXT_NODE) range.setStart(node, 0);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { innerOf, pageOf, renderDoc, rootOf, seatAtElement, seatInInner, stubRangeRects };
