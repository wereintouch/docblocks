// The DOM selection mapping tests' shared stand: the doc's render over the
// provider, the block's / the text node's DOM reads, the cross-block's
// selection's stands, and the per-test cleanup.
import { cleanup, render } from "@testing-library/react";
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

/** The editor root element. */
function rootOf(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
  expect(root, "the editor root should be rendered").not.toBeNull();
  return root!;
}

/** The wrapper element of the block (any block type). */
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

/** The block's text node (the test docs carry one unmarked run per block). */
function textNodeOf(id: BlockId): Text {
  const node = innerOf(id).firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/** Select from (block a, offset aOffset) to (block b, offset bOffset) in document order. */
function selectAcross(a: BlockId, aOffset: number, b: BlockId, bOffset: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Select between two element nodes (for non-text endpoints). */
function selectElements(a: Node, b: Node): void {
  const range = document.createRange();
  range.setStart(a, 0);
  range.setEnd(b, 0);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { innerOf, renderDoc, rootOf, selectAcross, selectElements, textNodeOf, wrapperOf };
