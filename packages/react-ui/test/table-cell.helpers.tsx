// The table-cell tests' shared stand: the 2x2 table's render (the
// provider's context capture), the cell's activation layer / the
// materialized paragraph / the inner editable's reads, the caret's seat,
// and the paste's dispatch.
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { EditorContextValue } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

// Captures the provider context at render time (the selection handle is a
// stable ref object — `.view` read later is the live event-time value).
let editorContext: EditorContextValue | null = null;
function ContextCapture() {
  editorContext = useEditorContext();
  return null;
}

/**
 * A 2x2 table (the default width, no columnWidths yet) as the next block
 * after the seeded page paragraph; `fillFirst` adds a paragraph to the
 * first cell. Captures the table / row / cell ids.
 */
function renderTableDoc(fillFirst = false) {
  let firstCellId = "";
  const doc = createDoc({ id: "doc-tbl", createdAt: CREATED_AT });
  const pageId = doc.insertBlock("paragraph");
  doc.insertText(pageId, 0, "before");
  const tableId = doc.insertBlock("table", { cols: 2 });
  const rowIds: BlockId[] = [];
  for (let r = 0; r < 2; r++) {
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    rowIds.push(rowId);
    for (let c = 0; c < 2; c++) {
      const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
      if (r === 0 && c === 0) firstCellId = cellId;
    }
  }
  if (fillFirst) {
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: firstCellId });
    doc.insertText(paragraphId, 0, "cell text");
  }
  render(
    <EditorProvider doc={doc}>
      <Editor />
      <ContextCapture />
    </EditorProvider>
  );
  return { doc, tableId, pageId, firstCellId, rowIds };
}

/** The cell's activation layer (the empty cell's local editable). */
function activationOf(cellId: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-slot="docblocks/table-cell"][data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`
  );
  expect(el, "the empty cell should render the activation layer").not.toBeNull();
  return el!;
}

/** The cell's first child paragraph wrapper (after the activation materialized). */
function cellParagraphOf(cellId: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(
    `[data-slot="docblocks/table-cell"][data-block-id="${cellId}"] [data-slot="docblocks/block"][data-block-type="paragraph"]`
  );
  expect(el, "the cell should render the materialized paragraph").not.toBeNull();
  return el!;
}

/** The inner editable of a block wrapper (the contenteditable element). */
function innerOf(wrapper: HTMLElement): HTMLElement {
  const inner = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
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

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

export { CREATED_AT, activationOf, caretAt, cellParagraphOf, dispatchPaste, editorContext, innerOf, renderTableDoc };
