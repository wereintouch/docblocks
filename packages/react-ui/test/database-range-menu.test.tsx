// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function ctx(): MutationContext {
  return newMutationContext();
}

async function renderGrid() {
  const bridge = createMemoryDatabaseBridge();
  const table = await bridge.createTable({ name: "Range" }, ctx());
  const tableId = table.result.id;
  const first = await bridge.createColumn(
    tableId,
    { column: { name: "First", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const second = await bridge.createColumn(
    tableId,
    { column: { name: "Second", type: "text", position: 1, nullable: true } },
    ctx()
  );
  const receipt = await bridge.batchRows(
    tableId,
    {
      ops: [
        { op: "create", row: { [first.result.id]: "a1", [second.result.id]: "a2" }, beforeRowId: null },
        { op: "create", row: { [first.result.id]: "b1", [second.result.id]: "b2" }, beforeRowId: null },
      ],
    },
    ctx()
  );
  const doc = createDoc({ id: "doc-range" });
  doc.insertBlock("database", { tableId });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    bridge,
    tableId,
    columns: [first.result.id, second.result.id],
    rowIds: receipt.result.rows.map((row) => row.id),
  };
}

function cellOf(row: number, col: number): HTMLElement {
  const cell = document.querySelector<HTMLElement>(
    `[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`
  );
  if (cell === null) throw new Error(`Missing cell ${row}:${col}`);
  return cell;
}

async function selectRange(): Promise<void> {
  const original = document.elementFromPoint;
  document.elementFromPoint = () => cellOf(1, 1);
  fireEvent.pointerDown(cellOf(0, 0), { button: 0, clientX: 10, clientY: 5 });
  fireEvent.pointerMove(cellOf(0, 0), { clientX: 60, clientY: 60 });
  fireEvent.pointerUp(cellOf(0, 0), { clientX: 60, clientY: 60 });
  document.elementFromPoint = original;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openRangeMenu(): Promise<void> {
  fireEvent.contextMenu(cellOf(0, 0), { clientX: 20, clientY: 20, buttons: 0 });
  await waitFor(() => {
    expect(document.querySelector("[data-slot='docblocks/database-context-menu']")).not.toBeNull();
  });
}

async function clickUndo(): Promise<void> {
  const undo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-undo']");
  expect(undo).not.toBeNull();
  fireEvent.click(undo!);
}

describe("the database range context menu", () => {
  it("clears the selected range in one batch and restores it with one undo", async () => {
    const { bridge, tableId, columns, rowIds } = await renderGrid();
    const batchSpy = vi.spyOn(bridge, "batchRows");
    await selectRange();
    await openRangeMenu();
    fireEvent.click(document.querySelector("[data-slot='docblocks/database-context-clear']")!);
    await waitFor(async () => {
      const page = await bridge.snapshotTable(tableId, {});
      expect(page.page.rows.every((row) => columns.every((column) => row.cells[column] == null))).toBe(true);
    });
    const clears = batchSpy.mock.calls.filter(([, input]) => input.ops.every((op) => op.op === "update"));
    expect(clears).toHaveLength(1);
    expect(clears[0]?.[1].ops).toHaveLength(2);
    await clickUndo();
    await waitFor(async () => {
      const page = await bridge.snapshotTable(tableId, {});
      expect(page.page.rows.map((row) => row.cells[columns[0]!])).toEqual(["a1", "b1"]);
      expect(page.page.rows.map((row) => row.cells[columns[1]!])).toEqual(["a2", "b2"]);
      expect(page.page.rows.map((row) => row.id)).toEqual(rowIds);
    });
  });

  it("deletes every selected row in one batch and restores both with one undo", async () => {
    const { bridge, tableId, rowIds } = await renderGrid();
    const batchSpy = vi.spyOn(bridge, "batchRows");
    await selectRange();
    await openRangeMenu();
    fireEvent.click(document.querySelector("[data-slot='docblocks/database-context-delete']")!);
    await waitFor(async () => {
      expect((await bridge.snapshotTable(tableId, {})).page.rows).toHaveLength(0);
    });
    const deletes = batchSpy.mock.calls.filter(([, input]) => input.ops.every((op) => op.op === "delete"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.[1].ops.flatMap((op) => (op.op === "delete" ? [op.rowId] : []))).toEqual(rowIds);
    await clickUndo();
    await waitFor(async () => {
      expect((await bridge.snapshotTable(tableId, {})).page.rows.map((row) => row.id)).toEqual(rowIds);
    });
  });

  it("cancels a held-open menu when the selection clears before release", async () => {
    await renderGrid();
    await selectRange();
    fireEvent.contextMenu(cellOf(0, 0), { buttons: 2, clientX: 20, clientY: 20 });
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']")!;
    fireEvent.keyDown(table, { key: "Escape", bubbles: true });
    fireEvent.pointerUp(window, { button: 2 });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.querySelector("[data-slot='docblocks/database-context-menu']")).toBeNull();
  });

  it("keeps the native menu without a multi-cell selection and in read-only mode", async () => {
    await renderGrid();
    fireEvent.contextMenu(cellOf(0, 0), { buttons: 0 });
    expect(document.querySelector("[data-slot='docblocks/database-context-menu']")).toBeNull();
    cleanup();
    const bridge = createMemoryDatabaseBridge();
    const table = await bridge.createTable({ name: "Read only" }, ctx());
    const column = await bridge.createColumn(
      table.result.id,
      { column: { name: "Text", type: "text", position: 0, nullable: true } },
      ctx()
    );
    await bridge.batchRows(
      table.result.id,
      { ops: [{ op: "create", row: { [column.result.id]: "value" }, beforeRowId: null }] },
      ctx()
    );
    const readOnlyDoc = createDoc({ id: "doc-read-only" });
    readOnlyDoc.insertBlock("database", { tableId: table.result.id });
    render(
      <EditorProvider doc={readOnlyDoc} databaseBridge={bridge} mode="view">
        <Editor />
      </EditorProvider>
    );
    await waitFor(() => expect(document.querySelector("[data-slot='docblocks/database-cell']")).not.toBeNull());
    fireEvent.contextMenu(document.querySelector("[data-slot='docblocks/database-cell']")!, { buttons: 0 });
    expect(document.querySelector("[data-slot='docblocks/database-context-menu']")).toBeNull();
  });
});
