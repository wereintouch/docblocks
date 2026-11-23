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

// the text cell's draft contract spec — part 1 of 1.

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

/** Polls the condition over the settled frames (the radix portals settle async). */
async function until(condition: () => unknown | Promise<unknown>, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if (await condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** The row's cells over the bridge's page (the page's row order stands). */
async function cellsOf(bridge: DatabaseBridge, tableId: string, rowId: string): Promise<Record<string, unknown>> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows.find((entry) => entry.id === rowId);
  if (row === undefined) throw new Error(`the row "${rowId}" is not in the table "${tableId}"`);
  return row.cells;
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

describe("the text cell's draft contract (the open stand over the peer's mid-session commit)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);
  /** The press's selection stand (the document-level teardown listener stands over it). */
  const pressSelect = async (cell: HTMLElement) => {
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    await settleGrid();
  };
  /** The double press's edit open (the portaled textarea's stand). */
  const openTextEdit = async (cell: HTMLElement) => {
    await pressSelect(cell);
    fireEvent.doubleClick(cell);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-cell-multiline']") !== null,
      "the edit textarea"
    );
  };
  /** The outside press's teardown stand (the draft's commit path). */
  const outsidePress = async () => {
    fireEvent.pointerDown(document.body, { button: 0, clientX: 5, clientY: 5 });
    await settleGrid();
  };

  it("the peer's mid-session commit stands the conflict (the draft's commit is rejected, the peer's value stands)", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const rowId = await rowIdAt(bridge, tableId, 0);
    const cell = cellOf(0, 0)!;
    await openTextEdit(cell);
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "typed draft" } });
    });
    // The peer's commit over the same cell (the refetch's re-baseline —
    // the cell's data-empty's flip stands the fresh render over the
    // session).
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [cols.title]: null } }] }, ctx());
    await until(() => cell.getAttribute("data-empty") === "true", "the peer's value's render stand");
    await outsidePress();
    // The conflict stand: the peer's value stands (the draft's commit is
    // rejected over the open-time's pinned revision — no silent overwrite).
    expect((await cellsOf(bridge, tableId, rowId))[cols.title] ?? null).toBeNull();
    expect(cell.textContent).toBe("");
  });
  it("the untouched draft over the peer's mid-session commit stands no write (the empty draft's clobber is out)", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const rowId = await rowIdAt(bridge, tableId, 0);
    const cell = cellOf(0, 0)!;
    await openTextEdit(cell);
    // The peer's commit while the session stands (the draft is untouched).
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [cols.title]: null } }] }, ctx());
    await until(() => cell.getAttribute("data-empty") === "true", "the peer's value's render stand");
    await outsidePress();
    // The open-time's unchanged stand: no commit (the peer's value stands,
    // not the open-time's stale value).
    expect((await cellsOf(bridge, tableId, rowId))[cols.title] ?? null).toBeNull();
    expect(cell.textContent).toBe("");
  });
});
