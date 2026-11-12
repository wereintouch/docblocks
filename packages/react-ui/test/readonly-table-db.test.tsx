// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { newMutationContext } from "../src/database";
import type { MutationContext } from "../src/database";
import { EditorProvider } from "../src/editor-provider";

// The radix Select drives the cell's pick through the pointer-capture API,
// which jsdom does not implement. The stubs keep the grid testable.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The write context (a fresh operation id per call). */
const ctx = (): MutationContext => newMutationContext();

/** Waits for the grid's async load to settle (the ready phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the table's read-only stand (the view / published's modes)", () => {
  afterEach(cleanup);

  it("stands the cells not editable and the editing's chrome off (the view's mode)", () => {
    const doc = createDoc({ id: "doc-rt-1", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 2 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    doc.insertBlock("table-cell", undefined, { parent: rowId });
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const table = container.querySelector<HTMLElement>('[data-slot="docblocks/table"]');
    expect(table, "the table should render").not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/table-add-row"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/table-add-column"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/table-col-resize"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
  });

  it("the read-only's empty cell renders the height's placeholder (the edit's minimum row height's parity; no activation layer)", () => {
    const doc = createDoc({ id: "doc-rt-1b", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 2 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    doc.insertBlock("table-cell", undefined, { parent: rowId });
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const placeholder = container.querySelector('[data-slot="docblocks/cell-empty"]');
    expect(placeholder, "the placeholder should render").not.toBeNull();
    expect(placeholder?.textContent).toBe("\u200b");
    expect(container.querySelector('[data-slot="docblocks/cell-activation"]')).toBeNull();

    // The edit's mode parity: the activation layer renders, the placeholder
    // does not.
    const doc2 = createDoc({ id: "doc-rt-1c", createdAt: CREATED_AT });
    const tableId2 = doc2.insertBlock("table", { cols: 2 });
    const rowId2 = doc2.insertBlock("table-row", undefined, { parent: tableId2 });
    doc2.insertBlock("table-cell", undefined, { parent: rowId2 });
    const { container: editContainer } = render(
      <EditorProvider doc={doc2}>
        <Editor />
      </EditorProvider>
    );
    expect(editContainer.querySelector('[data-slot="docblocks/cell-activation"]')).not.toBeNull();
    expect(editContainer.querySelector('[data-slot="docblocks/cell-empty"]')).toBeNull();
  });

  it("stands the editable's stand over the edit's mode (the add chips' parity)", () => {
    const doc = createDoc({ id: "doc-rt-2", createdAt: CREATED_AT });
    doc.insertBlock("table");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(container.querySelector('[data-slot="docblocks/table-add-row"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/table-add-column"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/table-col-resize"]')).not.toBeNull();
  });

  it("the cell's layer stands contenteditable=false over the view's mode", () => {
    const doc = createDoc({ id: "doc-rt-3", createdAt: CREATED_AT });
    const tableId = doc.insertBlock("table", { cols: 2 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const paragraphId = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(paragraphId, 0, "cell text");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector<HTMLElement>(
      `[data-block-id="${paragraphId}"][data-slot="docblocks/block-content"]`
    );
    expect(inner, "the cell's paragraph's inner should render").not.toBeNull();
    expect(inner?.getAttribute("contenteditable")).toBe("false");
  });

  it("stands no comment's text over the cell's render (the JSX text's regression pin, all the modes)", () => {
    const doc = createDoc({ id: "doc-rt-4", createdAt: CREATED_AT });
    doc.insertBlock("table", { cols: 2 });
    for (const mode of [undefined, "view" as const]) {
      const { container, unmount } = render(
        <EditorProvider doc={doc} mode={mode}>
          <Editor />
        </EditorProvider>
      );
      for (const cell of container.querySelectorAll<HTMLElement>("[data-slot='docblocks/table-cell']")) {
        expect(cell.textContent ?? "").not.toContain("//");
        expect(cell.textContent ?? "").not.toContain("The cell's activation layer");
      }
      unmount();
    }
  });
});

describe("the database's grid read-only stand (the view's mode)", () => {
  afterEach(cleanup);

  it("stands the grid's data rendered and the editing's chrome off (the view's mode)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Frozen" }, ctx())).result.id;
    const title = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Title", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [title]: "a row" }, beforeRowId: null }] }, ctx());
    const doc = createDoc({ id: "doc-rt-4", createdAt: CREATED_AT });
    doc.insertBlock("database", { tableId });
    const { container } = render(
      <EditorProvider doc={doc} mode="view" databaseBridge={bridge}>
        <Editor />
      </EditorProvider>
    );
    await settleGrid();
    // The data's stand: the rows render over the bridge's read (the read-only
    // stand is the editing's path, not the data's render).
    expect(container.textContent).toContain("a row");
    expect(container.querySelector('[data-slot="docblocks/database-add-row"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/database-undo"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/database-redo"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/database-filter"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/database-add-column-trigger"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/database-row-menu-trigger"]')).toBeNull();
    // The name's display stands plain (the rename's entry is off).
    expect(container.querySelector('[data-slot="docblocks/database-name"] input')).toBeNull();
  });
});
