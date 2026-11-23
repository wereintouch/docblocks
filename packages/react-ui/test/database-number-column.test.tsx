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

// the number column spec — part 1 of 6.

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

/** The row's cells over the bridge's page (the page's row order stands). */
async function cellsOf(bridge: DatabaseBridge, tableId: string, rowId: string): Promise<Record<string, unknown>> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows.find((entry) => entry.id === rowId);
  if (row === undefined) throw new Error(`the row "${rowId}" is not in the table "${tableId}"`);
  return row.cells;
}

/** The first row's id of the table's page. */
async function firstRowId(bridge: DatabaseBridge, tableId: string): Promise<string> {
  const page = await bridge.snapshotTable(tableId, {});
  if (page.page.rows[0] === undefined) throw new Error(`the table "${tableId}" stands no rows`);
  return page.page.rows[0].id;
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

describe("the number column (the display format + the create form)", () => {
  it("the cell's display stands the column's format (the prefix / the thousands / the suffix; the raw number stays the data)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = await firstRowId(bridge, tableId);
    const num = (
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Num",
            type: "number",
            position: 4,
            nullable: true,
            numberDisplay: { decimals: 0, thousands: true, prefix: "AAA", suffix: "BBB", allowNegative: true },
          },
        },
        ctx()
      )
    ).result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [num]: 555222 } }] }, ctx());
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${num}']`);
    expect(cell()!.textContent).toBe("AAA 555 222 BBB");
    // The row's data keeps the raw number (the format is the display stand
    // only — the consumer's data is never rewritten).
    expect((await cellsOf(bridge, tableId, rowId))[num]).toBe(555222);
  });
  it("the decimals stand the fixed digit count after the point (the absent stand is the integer)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = await firstRowId(bridge, tableId);
    const frac = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Frac", type: "number", position: 4, nullable: true, numberDisplay: { decimals: 2 } } },
        ctx()
      )
    ).result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [frac]: 5 } }] }, ctx());
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${frac}']`);
    expect(cell()!.textContent).toBe("5.00");
  });
  it("the negative's reject (the allowNegative is false): the commit reverts, the valid stand commits", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = await firstRowId(bridge, tableId);
    const pos = (
      await bridge.createColumn(
        tableId,
        {
          column: { name: "Pos", type: "number", position: 4, nullable: true, numberDisplay: { allowNegative: false } },
        },
        ctx()
      )
    ).result.id;
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${pos}']`);
    // The double press enters the edit (the input stands min=0).
    fireEvent.pointerDown(cell()!, { button: 0 });
    fireEvent.doubleClick(cell()!);
    const input = () => cell()!.querySelector<HTMLInputElement>("input[type='number']");
    expect(input()).not.toBeNull();
    expect(input()!.getAttribute("min")).toBe("0");

    // The negative's commit reverts (no write over the bridge).
    fireEvent.change(input()!, { target: { value: "-5" } });
    fireEvent.blur(input()!);
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[pos] ?? null).toBeNull();

    // The valid stand commits.
    fireEvent.pointerDown(cell()!, { button: 0 });
    fireEvent.doubleClick(cell()!);
    fireEvent.change(input()!, { target: { value: "7" } });
    fireEvent.blur(input()!);
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[pos]).toBe(7);
  });
});
