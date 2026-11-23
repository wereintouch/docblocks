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

// the grid's header spec — part 7 of 12.

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
  it("the row-link's picker: the search filters the rows; the pick commits the row id; the clear entry clears", async () => {
    const { bridge, tableId } = await renderGrid();
    const people = await bridge.createTable({ name: "People" }, ctx());
    const peopleId = people.result.id;
    const nameCol = (
      await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const peopleReceipt = await bridge.batchRows(
      peopleId,
      {
        ops: [
          { op: "create", row: { [nameCol]: "Ann" }, beforeRowId: null },
          { op: "create", row: { [nameCol]: "Bob" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const annId = peopleReceipt.result.rows[0]!.id;
    const bobId = peopleReceipt.result.rows[1]!.id;
    const owner = (
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Owner",
            type: "text",
            position: 4,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      )
    ).result.id;
    const rowId = await firstRowId(bridge, tableId);
    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${owner}']`);
    await until(() => cell() !== null, "the cell");

    // The double press opens the picker (the search + the rows over the
    // resolved displays).
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='docblocks/database-row-picker']") !== null, "the picker");
    expect(
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-row-picker-row'][data-row-id='${annId}']`)
        ?.textContent
    ).toBe("Ann");
    // The search filters the list (the client-side stand over the loaded
    // page).
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-row-picker-search']")!, {
      target: { value: "bo" },
    });
    await settleGrid();
    expect(
      document.querySelector(`[data-slot='docblocks/database-row-picker-row'][data-row-id='${annId}']`)
    ).toBeNull();
    const bobRow = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-row-picker-row'][data-row-id='${bobId}']`
    )!;
    expect(bobRow.textContent).toBe("Bob");
    fireEvent.click(bobRow);
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[owner]).toBe(bobId);
    await until(() => (cell()!.textContent ?? "").includes("Bob"), "the new display");

    // The clear entry stands the null.
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='docblocks/database-row-picker']") !== null, "the picker");
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-row-picker-clear']")!);
    await settleGrid();
    const cells = await cellsOf(bridge, tableId, rowId);
    expect(cells[owner] ?? null).toBeNull();
  });
});
