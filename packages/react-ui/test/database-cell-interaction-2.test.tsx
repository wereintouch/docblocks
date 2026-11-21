// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the cell interaction spec — part 2 of 5.

// The radix Select drives the cell's pick through the pointer-capture API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open/pick gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/** Seeds the doc (prepare returns the database id), then renders provider + editor. */
function renderDoc(
  prepare: (doc: TestDoc) => string,
  renderers?: BlockRendererMap,
  bridge?: DatabaseBridge
): { doc: TestDoc; db: string } {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = prepare(doc);
  render(
    <EditorProvider doc={doc} blockRenderers={renderers} databaseBridge={bridge ?? getDefaultBridge()}>
      <Editor />
    </EditorProvider>
  );
  return { doc, db };
}

// A module-shared default bridge so the inline-form tests (which pass no
// bridge) share one instance; the external-form tests seed their own table
// on a fresh bridge to keep the assertions deterministic.
let defaultBridge: DatabaseBridge | null = null;
function getDefaultBridge(): DatabaseBridge {
  defaultBridge ??= createMemoryDatabaseBridge();
  return defaultBridge;
}

/** Waits for the grid's async load to settle (the ready / broken phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** The grid's seeded ids: the table, the enum's options table, the
 *  bridge-assigned column ids, and the option's row ids (the enum's cell
 *  value is the option's row id, the display stands the name's label). */
interface SeededGrid {
  bridge: ReturnType<typeof createMemoryDatabaseBridge>;
  tableId: string;
  statusesId: string;
  cols: { title: string; n: string; done: string; status: string };
  optionCols: { name: string; color: string };
  options: { todo: string; active: string; done: string };
}

/** Seeds the grid's tables over the bridge (the Demo table + the Statuses'
 *  option rows), returning the generated ids. */
async function seedGrid(bridge: ReturnType<typeof createMemoryDatabaseBridge>): Promise<SeededGrid> {
  const table = await bridge.createTable({ name: "Demo" }, ctx());
  const tableId = table.result.id;
  // The options' table (the option IS a row — the `name` / the `color`
  // columns stand the labels / the chip's colors over the cell's keys).
  const statuses = await bridge.createTable({ name: "Statuses" }, ctx());
  const statusesId = statuses.result.id;
  const optionName = await bridge.createColumn(
    statusesId,
    { column: { name: "name", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const optionColor = await bridge.createColumn(
    statusesId,
    { column: { name: "color", type: "text", position: 1, nullable: true } },
    ctx()
  );
  const option = async (label: string): Promise<string> =>
    (
      await bridge.batchRows(
        statusesId,
        { ops: [{ op: "create", row: { [optionName.result.id]: label }, beforeRowId: null }] },
        ctx()
      )
    ).result.rows[0]!.id;
  const options = { todo: await option("todo"), active: await option("active"), done: await option("done") };
  const title = await bridge.createColumn(
    tableId,
    { column: { name: "Title", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const n = await bridge.createColumn(
    tableId,
    { column: { name: "N", type: "integer", position: 1, nullable: true } },
    ctx()
  );
  const done = await bridge.createColumn(
    tableId,
    { column: { name: "Done", type: "boolean", position: 2, nullable: true } },
    ctx()
  );
  const status = await bridge.createColumn(
    tableId,
    {
      column: {
        name: "Status",
        type: "text",
        position: 3,
        nullable: true,
        reference: { kind: "enum", tableId: statusesId, many: false },
      },
    },
    ctx()
  );
  await bridge.batchRows(
    tableId,
    {
      ops: [
        {
          op: "create",
          row: {
            [title.result.id]: "a",
            [n.result.id]: 1,
            [done.result.id]: false,
            [status.result.id]: options.todo,
          },
          beforeRowId: null,
        },
        {
          op: "create",
          row: {
            [title.result.id]: "b",
            [n.result.id]: 2,
            [done.result.id]: true,
            [status.result.id]: options.active,
          },
          beforeRowId: null,
        },
      ],
    },
    ctx()
  );
  return {
    bridge,
    tableId,
    statusesId,
    cols: { title: title.result.id, n: n.result.id, done: done.result.id, status: status.result.id },
    optionCols: { name: optionName.result.id, color: optionColor.result.id },
    options,
  };
}

/** The grid on a fresh bridge (title / n / done / status; two rows). */
async function renderGrid(attrs: Record<string, unknown> = {}) {
  const bridge = createMemoryDatabaseBridge();
  const seeded = await seedGrid(bridge);
  const { doc, db } = renderDoc(
    (d) => d.insertBlock("database", { tableId: seeded.tableId, ...attrs }),
    undefined,
    bridge
  );
  await settleGrid();
  return { doc, db, ...seeded };
}

afterEach(() => cleanup());

describe("the cell interaction (the selection, the edit, the multi-select clear)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  it("the press-drag stands the rectangular region; the Delete stands the clear (one update per row; the boolean uncheck)", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    // The drag from the (0,0) to the (1,2): the jsdom elementFromPoint
    // stands the target cell stub (the region is the 2x3).
    const a = cellOf(0, 0)!;
    const b = cellOf(1, 2)!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => b;
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(a, { clientX: 60, clientY: 60 });
    await settleGrid();
    // The live region stands the selection (the 2x3 rectangle), the doc
    // stands until the Delete.
    expect(cellOf(0, 0)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 1)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 2)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 0)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 1)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 2)!.getAttribute("data-selected")).toBe("true");
    // The multi-selection's stand: the fill (the canvas selection's fill —
    // the border token at 50%), no outline (the outline stands the sole
    // selection — the region stands no frame on any cell).
    expect(cellOf(0, 0)!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(cellOf(0, 0)!.className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(cellOf(1, 1)!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(cellOf(1, 1)!.className).not.toContain("outline-offset-1");
    document.elementFromPoint = original;
    fireEvent.pointerUp(a, { clientX: 60, clientY: 60 });
    await settleGrid();

    // The Delete over the stand: one update per row (the columns are the
    // null cells; the boolean null stands the unchecked box).
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "Delete", bubbles: true });
    await settleGrid();
    const page = await bridge.snapshotTable(tableId, {});
    const [rowA, rowB] = page.page.rows;
    expect(rowA!.cells[cols.title] ?? null).toBeNull();
    expect(rowA!.cells[cols.n] ?? null).toBeNull();
    expect(rowA!.cells[cols.done] ?? null).toBeNull();
    expect(rowB!.cells[cols.title] ?? null).toBeNull();
    expect(rowB!.cells[cols.n] ?? null).toBeNull();
    expect(rowB!.cells[cols.done] ?? null).toBeNull();
    // The selection stands after the clear (the stand is the view state).
    expect(cellOf(0, 0)!.getAttribute("data-selected")).toBe("true");
  });
  it("the region clear stands ONE commit: the grid's Undo stands every cleared row back over the single press", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const a = cellOf(0, 0)!;
    const b = cellOf(1, 1)!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => b;
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(a, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(a, { clientX: 60, clientY: 60 });
    document.elementFromPoint = original;
    await settleGrid();
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "Delete", bubbles: true });
    await settleGrid();
    let page = await bridge.snapshotTable(tableId, {});
    for (const row of page.page.rows) {
      expect(row.cells[cols.title] ?? null).toBeNull();
      expect(row.cells[cols.n] ?? null).toBeNull();
    }
    // The ONE commit: the grid's Undo stands the WHOLE clear back (both
    // rows) over the single press — not one row per press.
    const undo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-undo']");
    expect(undo).not.toBeNull();
    expect(undo!.hasAttribute("disabled")).toBe(false);
    fireEvent.click(undo!);
    await settleGrid();
    page = await bridge.snapshotTable(tableId, {});
    const restored = page.page.rows;
    expect(restored[0]!.cells[cols.title]).toBe("a");
    expect(restored[0]!.cells[cols.n]).toBe(1);
    expect(restored[1]!.cells[cols.title]).toBe("b");
    expect(restored[1]!.cells[cols.n]).toBe(2);
    // The redo stands the clear again over the single press.
    const redo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-redo']");
    fireEvent.click(redo!);
    await settleGrid();
    page = await bridge.snapshotTable(tableId, {});
    for (const row of page.page.rows) expect(row.cells[cols.title] ?? null).toBeNull();
  });
});
