// The input-safety unit tests' shared stand: the one-paragraph's render
// fixture (the `paragraphId`'s live stand), the caret / the paste's DOM
// gestures, the block's count, and the per-test cleanup.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

let paragraphId: BlockId = "";

/** Render a doc with one paragraph ("hello"); the id is captured by the prepare callback. */
function renderParagraph(text = "hello") {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  paragraphId = doc.insertBlock("paragraph");
  if (text !== "") doc.insertText(paragraphId, 0, text);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The rendered paragraph wrapper element. */
function paragraphEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${paragraphId}"]`);
  expect(el, "the paragraph should be rendered").not.toBeNull();
  return el!;
}

/** The paragraph's inner editable (the contenteditable element). */
function innerEl(): HTMLElement {
  const inner = paragraphEl().querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/** Place the DOM caret at `offset` of the inner editable's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the inner editable should have a text node").not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

/** Dispatch a paste event whose clipboard holds the given plain text (and optionally the html). */
function dispatchPaste(el: HTMLElement, plainText: string, htmlText = ""): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => (format === "text/plain" ? plainText : htmlText) },
  });
  return el.dispatchEvent(event);
}

/** The total number of blocks in the doc. */
function blockCount(doc: TestDoc): number {
  return Object.keys(doc.toJSON().blocks).length;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { CREATED_AT, blockCount, caretAt, dispatchPaste, innerEl, paragraphEl, paragraphId, renderParagraph };
export type { TestDoc };
