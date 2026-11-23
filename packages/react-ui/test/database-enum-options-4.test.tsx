// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../src/database/bridge";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the enum's options mechanics spec — part 4 of 4.

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

/** Renders provider + editor (the bridge is the grid's seed bridge). */
function renderDoc(prepare: (doc: TestDoc) => string, bridge: DatabaseBridge): { doc: TestDoc; db: string } {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = prepare(doc);
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  return { doc, db };
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

/** The page's row id at the given index (the page's order stand). */
async function rowIdAt(bridge: DatabaseBridge, tableId: string, index: number): Promise<string> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows[index];
  if (row === undefined) throw new Error(`the table "${tableId}" stands no row at the index ${index}`);
  return row.id;
}

/** The grid on a fresh bridge (title / n / done / status; two rows; the
 *  Statuses' option table with the todo / active / done rows). */
async function renderGrid(attrs: Record<string, unknown> = {}) {
  const bridge = createMemoryDatabaseBridge();
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
  const { doc, db } = renderDoc((d) => d.insertBlock("database", { tableId, ...attrs }), bridge);
  await settleGrid();
  return {
    doc,
    db,
    bridge,
    tableId,
    statusesId,
    cols: { title: title.result.id, n: n.result.id, done: done.result.id, status: status.result.id },
    optionCols: { name: optionName.result.id, color: optionColor.result.id },
    options,
  };
}

describe("the enum's options' mechanics (the system table; the create / the edit's form; the chip's display)", () => {
  it("the enum cell's chip stands the option's color (the empty stand stands the background only)", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const enumTableId = (await bridge.createTable({ name: "Color-enum", system: true }, ctx())).result.id;
    const nameCol = (
      await bridge.createColumn(
        enumTableId,
        { column: { name: ENUM_OPTION_NAME_COLUMN, type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const colorCol = (
      await bridge.createColumn(
        enumTableId,
        { column: { name: ENUM_OPTION_COLOR_COLUMN, type: "text", position: 1, nullable: true } },
        ctx()
      )
    ).result.id;
    const options = await bridge.batchRows(
      enumTableId,
      {
        ops: [
          { op: "create", row: { [nameCol]: "green", [colorCol]: "#97e3a8" }, beforeRowId: null },
          { op: "create", row: { [nameCol]: "plain" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const greenRowId = options.result.rows[0]!.id;
    const plainRowId = options.result.rows[1]!.id;
    const tint = (
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Tint",
            type: "text",
            position: 4,
            nullable: true,
            reference: { kind: "enum", tableId: enumTableId, many: false },
          },
        },
        ctx()
      )
    ).result.id;
    const rowA = await rowIdAt(bridge, tableId, 0);
    const rowB = await rowIdAt(bridge, tableId, 1);
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId: rowA, cells: { [tint]: greenRowId } }] }, ctx());
    await settleGrid();
    const cellA = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='${tint}'][data-row='0']`
      )!;
    await until(() => cellA() !== null, "the cell");
    const chip = () => cellA().querySelector<HTMLElement>("[data-slot='docblocks/database-ref-chip']");
    await until(() => chip() !== null, "the chip");
    // The chip's background stands the option's color (the data's inline
    // stand), the label stands the option's name.
    expect(chip()!.style.backgroundColor).toBe("rgb(151, 227, 168)");
    expect(chip()!.textContent).toBe("green");
    // The no-color option stands the neutral chip (the muted background).
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId: rowB, cells: { [tint]: plainRowId } }] }, ctx());
    await settleGrid();
    const cellB = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='${tint}'][data-row='1']`
      )!;
    await until(() => cellB().querySelector("[data-slot='docblocks/database-ref-chip']") !== null, "the neutral chip");
    expect(cellB().querySelector<HTMLElement>("[data-slot='docblocks/database-ref-chip']")!.style.backgroundColor).toBe(
      ""
    );
    expect(cellB().getAttribute("data-empty")).not.toBe("true");
    // The empty stand: the cell's background only (no chip's box).
    await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [cols.title]: "c" }, beforeRowId: null }] }, ctx());
    await settleGrid();
    const cellC = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='${tint}'][data-row='2']`
      )!;
    await until(() => cellC() !== null, "the empty cell");
    expect(cellC().querySelector("[data-slot='docblocks/database-ref-chip']")).toBeNull();
    expect(cellC().getAttribute("data-empty")).toBe("true");
  });
});
