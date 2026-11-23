// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the grid's header spec — part 8 of 12.

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

describe("the grid's header (the table's name, the column menu, the column drag)", () => {
  it("the multi-enum cell: the display stands the chips; the editor's toggle commits the array", async () => {
    const { bridge, tableId, statusesId, options } = await renderGrid();
    const tags = (
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Tags",
            type: "text",
            position: 4,
            nullable: true,
            reference: { kind: "enum", tableId: statusesId, many: true },
          },
        },
        ctx()
      )
    ).result.id;
    const rowId = await firstRowId(bridge, tableId);
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "update", rowId, cells: { [tags]: [options.todo, options.done] } }] },
      ctx()
    );
    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${tags}']`);
    const chips = () =>
      cell() === null
        ? []
        : [...cell()!.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-ref-chip']")].map(
            (chip) => chip.textContent
          );
    await until(() => cell() !== null, "the cell");
    // The display stands the chips' train (the joined text is out).
    await until(() => chips().length === 2, "the chips");
    expect(chips()).toEqual(["todo", "done"]);

    // The double press opens the checkbox list (the toggle commits the
    // array immediately — one `update` per option).
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-ref-multi-option']") !== null,
      "the multi editor"
    );
    const option = (label: string) =>
      [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-ref-multi-option']")].find(
        (entry) => entry.textContent === label
      );
    // The checkboxes stand the committed values.
    expect(option("todo")!.getAttribute("data-state")).toBe("checked");
    expect(option("active")!.getAttribute("data-state")).not.toBe("checked");
    fireEvent.click(option("active")!);
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[tags]).toEqual([options.todo, options.done, options.active]);
    // The chips stand the live values.
    await until(() => chips().length === 3, "the chips' update");
    expect(chips()).toEqual(["todo", "done", "active"]);
    // The uncheck drops the option (the array's stand).
    fireEvent.click(option("todo")!);
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[tags]).toEqual([options.done, options.active]);
    await until(() => chips().length === 2, "the chips' uncheck");
    expect(chips()).toEqual(["done", "active"]);
  });
});
