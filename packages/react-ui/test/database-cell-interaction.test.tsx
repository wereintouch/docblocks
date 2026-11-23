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

// the cell interaction spec — part 1 of 5.

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

/** The page's row id at the given index (the page's order stand). */
async function rowIdAt(bridge: DatabaseBridge, tableId: string, index: number): Promise<string> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows[index];
  if (row === undefined) throw new Error(`the table "${tableId}" stands no row at the index ${index}`);
  return row.id;
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

  it("the single press selects the cell (the stand); the edit stands on the double press", async () => {
    await renderGrid();
    const titleCell = cellOf(0, 0);
    // The single press (the pointer session) stands the selection stand.
    fireEvent.pointerDown(titleCell!, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(titleCell!, { clientX: 10, clientY: 5 });
    await settleGrid();
    expect(titleCell!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 1)!.getAttribute("data-selected")).toBeNull();
    // The selection's stand: the canvas figure's outline token (the thin
    // cyan outline over the selection tint), the inset offset (the
    // negative — the four sides stand over the edge cells, the outset
    // frame would stand clipped by the scroller).
    expect(titleCell!.className).toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(titleCell!.className).toContain("outline-(length:--docblocks-canvas-selection-border-width)");
    expect(titleCell!.className).toContain("outline-offset-[-1px]");
    expect(cellOf(0, 1)!.className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
    // The edit stands on the double press (the portaled 6-row textarea's
    // mount), not the single one.
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).toBeNull();
    fireEvent.doubleClick(titleCell!);
    await settleGrid();
    expect(titleCell!.getAttribute("data-editing")).toBe("true");
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']");
    expect(textarea).not.toBeNull();
    expect(textarea!.rows).toBe(6);
    // The grid's pointer model stands the selection — the native text
    // selection over the drag is suppressed (the table's select-none; the
    // portaled textarea stands its own native text selection).
    expect(document.querySelector("[data-slot='docblocks/database-table']")!.className).toContain("select-none");
    // The header's background stands slightly over the rows' (the muted
    // token over the transparent row stand — the row's header distinction).
    expect(document.querySelector("[data-slot='docblocks/database-header-cell']")!.className).toContain("bg-muted/40");
    expect(titleCell!.className).not.toContain("bg-muted/40");
  });
  it("the empty cells stand empty (no placeholder, no trigger chrome)", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const rowId = await rowIdAt(bridge, tableId, 1);
    // The second row's status is the value; clear the title + n of it → the
    // cells stand empty (the display stand, no chrome).
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId, cells: { [cols.title]: null, [cols.n]: null } }] },
      ctx()
    );
    await settleGrid();
    const empty = cellOf(1, 0);
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("data-empty")).toBe("true");
    expect(empty!.textContent).toBe("");
    expect(empty!.querySelector("input")).toBeNull();
  });
});
