// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../src/database/bridge";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the enum's options mechanics spec — part 3 of 4.

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
  it("the enum's save stands the diff's atomic stand (the data's commit; the new option's index over the draft)", async () => {
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
    await bridge.batchRows(
      enumTableId,
      {
        ops: [
          { op: "create", row: { [nameCol]: "alpha", [colorCol]: "#f7a8a8" }, beforeRowId: null },
          { op: "create", row: { [nameCol]: "beta" }, beforeRowId: null },
        ],
      },
      ctx()
    );
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
    await settleGrid();
    // The edit's open (the column menu's "Edit options" entry).
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
    const beforeSeq = (await bridge.snapshotTable(enumTableId, {})).page.asOfSeq;
    // The diff: the rename (alpha → alfa), the option's add (gamma — the
    // draft's position 1, over the kept option), the delete (beta).
    const names = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      );
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
      { target: { value: "gamma" } }
    );
    await settleGrid();
    expect(names()).toEqual(["alfa", "beta", "gamma"]);
    // The delete of the beta (the draft's row 1 over the pre-add order).
    const deletes = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-delete']");
    fireEvent.click(deletes[1]!);
    await settleGrid();
    expect(names()).toEqual(["alfa", "gamma"]);
    // The reorder's diff stand (the move's op over the system table)
    // stands the framer's session — the synthetic events' live reorder is
    // not this jsdom's stand — the diff here is the rename + the add +
    // the delete only.
    expect(names()).toEqual(["alfa", "gamma"]);
    // The commit.
    const commitButton = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']");
    // The commit's button stands the disabled stand over the column name's
    // empty stand (the edit form's prefill stands the column's name).
    expect(commitButton).not.toBeNull();
    fireEvent.click(commitButton!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-add-column-form']") === null,
      "the form's close"
    );
    // The create's tail stand: the new option's own index is the draft's
    // tail position (the draft's position is not the created's index), and
    // the no-move's diff stands the data's commit alone.
    const afterPage = await bridge.snapshotTable(enumTableId, {});
    const afterNames = afterPage.page.rows.map((row) => row.cells[nameCol]);
    expect(afterNames).toEqual(["alfa", "gamma"]);
    // The commit's atomic stand over the negotiated capability: the data's
    // diff (the rename / the add / the delete) stands ONE commit — the
    // sequential's partial commits are not a stand.
    expect(afterPage.page.asOfSeq - beforeSeq).toBe(1);
  });
});
