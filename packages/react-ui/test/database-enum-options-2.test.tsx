// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../src/database/bridge";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the enum's options mechanics spec — part 2 of 4.

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

/** The first row's id of the table's page. */
async function firstRowId(bridge: DatabaseBridge, tableId: string): Promise<string> {
  const page = await bridge.snapshotTable(tableId, {});
  if (page.page.rows[0] === undefined) throw new Error(`the table "${tableId}" stands no rows`);
  return page.page.rows[0].id;
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
  it("the enum's edit form stands the diff commit (the values stand; the names / the order / the colors update)", async () => {
    const { bridge, tableId } = await renderGrid();
    // The enum column over the fresh system table (the created stand).
    const enumTableId = (await bridge.createTable({ name: "Stage-enum", system: true }, ctx())).result.id;
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
    const optionsReceipt = await bridge.batchRows(
      enumTableId,
      {
        ops: [
          { op: "create", row: { [nameCol]: "alpha", [colorCol]: "#f7a8a8" }, beforeRowId: null },
          { op: "create", row: { [nameCol]: "beta" }, beforeRowId: null },
        ],
      },
      ctx()
    );
    const alphaRowId = optionsReceipt.result.rows[0]!.id;
    const stage = (
      await bridge.createColumn(
        tableId,
        {
          column: {
            name: "Stage",
            type: "text",
            position: 4,
            nullable: true,
            reference: { kind: "enum", tableId: enumTableId, many: false },
          },
        },
        ctx()
      )
    ).result.id;
    const rowId = await firstRowId(bridge, tableId);
    // The cell value stands the option's row id (the edit's identity).
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [stage]: alphaRowId } }] }, ctx());
    await settleGrid();
    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${stage}']`);
    await until(() => cell() !== null, "the cell");
    await until(() => (cell()!.textContent ?? "").includes("alpha"), "the display");

    // The edit's open (the column menu's "Edit options" entry — the
    // header's press stands the menu): the draft prefills from the system
    // table (the order's stand, the names, the colors).
    const stageHeader = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-header-cell'][data-column-id='${stage}']`)!;
    const ellipsis = stageHeader().querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
    fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-column-edit-options']") !== null,
      "the edit entry"
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-column-edit-options']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-enum-options']") !== null, "the editor");
    const optionNames = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      );
    expect(optionNames()).toEqual(["alpha", "beta"]);
    // The color's swatch stands the committed hex (the alpha's red).
    const swatches = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-color']");
    expect(swatches[0]!.getAttribute("data-color")).toBe("#f7a8a8");

    // The diff: the rename (alpha → alfa), the option's add (gamma —
    // the draft's tail).
    fireEvent.change(
      document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")[0]!,
      {
        target: { value: "alfa" },
      }
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-add']")!);
    await settleGrid();
    fireEvent.change(
      document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")[2]!,
      {
        target: { value: "gamma" },
      }
    );
    // The reorder's diff stand (the move's op over the system table)
    // stands the framer's session — the synthetic events' live reorder is
    // not this jsdom's stand — the diff here is the rename + the add only.
    expect(optionNames()).toEqual(["alfa", "beta", "gamma"]);
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await settleGrid();
    await until(
      () => document.querySelector("[data-slot='docblocks/database-add-column-form']") === null,
      "the form's close"
    );

    // The diff's commit over the system table (the alpha's row stands its
    // id — the cell's value is intact; the name updated in place, the
    // gamma's create stands the tail).
    const afterPage = await bridge.snapshotTable(enumTableId, {});
    const rows = afterPage.page.rows;
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.id === alphaRowId)!.cells[nameCol]).toBe("alfa");
    expect(rows[0]!.id).toBe(alphaRowId); // the alpha's position stands
    expect(rows[2]!.cells[nameCol]).toBe("gamma"); // the create's tail stand
    expect(rows.find((row) => row.id === alphaRowId)!.cells[colorCol]).toBe("#f7a8a8");

    // The cell's display stands the renamed option (the identity's
    // resolution over the row id).
    await until(() => (cell()!.textContent ?? "").includes("alfa"), "the renamed display");
    // The picker's list stands the new option + the renamed one (the
    // old name is gone).
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-enum-picker-search']") !== null,
      "the picker"
    );
    const optionLabels = [
      ...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-picker-row']"),
    ].map((entry) => entry.textContent);
    expect(optionLabels).toEqual(["alfa", "beta", "gamma"]);
  });
});
