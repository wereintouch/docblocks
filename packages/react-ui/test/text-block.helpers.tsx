// The text-block tests' shared stand: the doc's render fixture (the
// provider + the context capture), the paragraph's reads, the inner's
// editable, the caret's seat, the selection's mapping's trigger, the
// view's selection's read, and the per-test's cleanup.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId, Selection } from "docblocks-core";

import { Editor } from "../src/Editor";
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

/** The id of the (single) paragraph block of the doc. */
function paragraphIdOf(doc: TestDoc): BlockId {
  const blocks = doc.toJSON().blocks;
  const id = Object.keys(blocks).find((key) => blocks[key]?.type === "paragraph");
  expect(id, "the doc should have a paragraph").toBeDefined();
  return id!;
}

/**
 * Seed the doc with content before the render (the store seeds from the
 * doc's snapshot at mount), then render the provider + editor + capture.
 */
function renderDoc(prepare: (doc: TestDoc) => void) {
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

/** The (single) paragraph wrapper element of the rendered editor. */
function paragraphOf(doc: TestDoc): HTMLElement {
  const el = document.querySelector(`[data-block-id="${paragraphIdOf(doc)}"]:not([data-slot="docblocks/row"])`);
  expect(el, "the paragraph should be rendered").not.toBeNull();
  return el as HTMLElement;
}

/** The inner editable of a block wrapper (the contenteditable element). */
function innerOf(wrapper: HTMLElement): HTMLElement {
  const inner = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner as HTMLElement;
}

/** Place the DOM caret at `offset` of the inner editable's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const inner = innerOf(el);
  const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the inner editable should have a text node").not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
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

afterEach(() => {
  cleanup();
  context = null;
});

export { caretAt, fireSelectionChange, innerOf, paragraphIdOf, paragraphOf, renderDoc, viewSelection };
export type { TestDoc };
