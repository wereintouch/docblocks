// The cross-selection tests' shared stand: the doc's render fixture,
// the wrapper's / the text node's reads, the cross's range's select
// (the selectionchange's mapping), the key's dispatch, the root's
// children, and the frame's flush + the per-test's cleanup.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

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

/** The wrapper element of the block. */
function wrapperOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  expect(el, `the block ${id} should be rendered`).not.toBeNull();
  return el!;
}

/** The block's text node (the test docs carry one unmarked run per block). */
function textNodeOf(id: BlockId): Text {
  const inner = wrapperOf(id).querySelector<HTMLElement>('[data-slot="docblocks/block-content"]')!;
  const node = inner.firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/**
 * Select from (block a, offset aOffset) to (block b, offset bOffset) in
 * document order and sync the view selection (the selectionchange mapping).
 */
function selectAcross(a: BlockId, aOffset: number, b: BlockId, bOffset: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

/** Dispatch a keydown on the wrapper; false when the handler suppressed the event. */
function key(wrapper: HTMLElement, name: string, init: KeyboardEventInit = {}): boolean {
  let result = true;
  act(() => {
    result = wrapper.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
    );
  });
  return result;
}

/** The root's children ids. */
function childrenOf(doc: TestDoc): BlockId[] {
  return doc.getChildren(doc.meta.id);
}

/** Flush the frame the store-driven re-render lands on. */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { childrenOf, flushFrames, key, renderDoc, selectAcross, textNodeOf, wrapperOf };
