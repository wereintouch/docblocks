// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { MutationContext } from "../src/database/bridge";
import { DATABASE_GRID_MIME } from "../src/database/grid/grid-cell-clipboard";
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
  const refs = await bridge.createTable({ name: "Refs" }, ctx());
  const refName = await bridge.createColumn(
    refs.result.id,
    { column: { name: "Name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const refRows = await bridge.batchRows(
    refs.result.id,
    {
      ops: [
        { op: "create", row: { [refName.result.id]: "One" }, beforeRowId: null },
        { op: "create", row: { [refName.result.id]: "Two" }, beforeRowId: null },
      ],
    },
    ctx()
  );
  const table = await bridge.createTable({ name: "Grid" }, ctx());
  const tableId = table.result.id;
  const enumColumn = await bridge.createColumn(
    tableId,
    {
      column: {
        name: "Enum",
        type: "text",
        position: 0,
        nullable: true,
        reference: { kind: "enum", tableId: refs.result.id, many: false },
      },
    },
    ctx()
  );
  const rowColumn = await bridge.createColumn(
    tableId,
    {
      column: {
        name: "Row",
        type: "text",
        position: 1,
        nullable: true,
        reference: { kind: "row", tableId: refs.result.id, many: false },
      },
    },
    ctx()
  );
  const original = refRows.result.rows[0]!.id;
  const next = refRows.result.rows[1]!.id;
  await bridge.batchRows(
    tableId,
    {
      ops: [
        {
          op: "create",
          row: { [enumColumn.result.id]: original, [rowColumn.result.id]: original },
          beforeRowId: null,
        },
      ],
    },
    ctx()
  );
  const doc = createDoc({ id: "doc-paste-range" });
  doc.insertBlock("database", { tableId });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  await waitFor(() => expect(document.querySelector("[data-slot='docblocks/database-cell']")).not.toBeNull());
  return {
    bridge,
    tableId,
    enumColumnId: enumColumn.result.id,
    rowColumnId: rowColumn.result.id,
    original,
    next,
  };
}

describe("the database structured paste range", () => {
  it("pastes raw references into updated and created rows, highlights them, and undoes once", async () => {
    const { bridge, tableId, enumColumnId, rowColumnId, original, next } = await renderGrid();
    const firstCell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-row='0']")!;
    fireEvent.pointerDown(firstCell, { button: 0 });
    fireEvent.pointerUp(firstCell);
    const payload = JSON.stringify({
      v: 1,
      tableId,
      cells: [
        [next, next],
        [next, next],
      ],
    });
    fireEvent.paste(document.querySelector("[data-slot='docblocks/database-table']")!, {
      clipboardData: {
        getData: (mime: string) =>
          mime === DATABASE_GRID_MIME ? payload : mime === "text/plain" ? "Two\tTwo\nTwo\tTwo" : "",
      },
    });
    await waitFor(async () => {
      expect((await bridge.snapshotTable(tableId, {})).page.rows).toHaveLength(2);
    });
    const page = await bridge.snapshotTable(tableId, {});
    for (const row of page.page.rows) {
      expect(row.cells[enumColumnId]).toBe(next);
      expect(row.cells[rowColumnId]).toBe(next);
    }
    await waitFor(() => {
      expect(document.querySelectorAll("[data-slot='docblocks/database-paste-range']")).toHaveLength(4);
    });
    fireEvent.pointerDown(document.querySelector("[data-slot='docblocks/database-cell'][data-row='1']")!, {
      button: 0,
    });
    expect(document.querySelectorAll("[data-slot='docblocks/database-paste-range']")).toHaveLength(0);
    fireEvent.click(document.querySelector("[data-slot='docblocks/database-undo']")!);
    await waitFor(async () => {
      expect((await bridge.snapshotTable(tableId, {})).page.rows).toHaveLength(1);
    });
    const restored = (await bridge.snapshotTable(tableId, {})).page.rows[0]!;
    expect(restored.cells[enumColumnId]).toBe(original);
    expect(restored.cells[rowColumnId]).toBe(original);
  });
});
