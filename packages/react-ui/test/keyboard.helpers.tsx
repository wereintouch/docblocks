// Shared fixture for the keyboard tests: the doc's render over the
// provider's context capture, the caret's / range's / key's DOM stand, and
// the view's selection's read / write.
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

export {
  caretAtFlat,
  context,
  expectCaret,
  fireSelectionChange,
  flushFrames,
  innerOf,
  key,
  positionAt,
  rangeAtFlat,
  renderDoc,
  setViewSelection,
  viewSelection,
  wrapperOf,
};
