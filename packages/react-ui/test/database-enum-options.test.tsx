// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { ENUM_OPTION_COLOR_COLUMN, ENUM_OPTION_NAME_COLUMN } from "../src/database/bridge";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the enum's options mechanics spec — part 1 of 4.

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

afterEach(() => cleanup());

describe("the enum's options' mechanics (the system table; the create / the edit's form; the chip's display)", () => {
  it("the system table stands hidden (the listTables stands it out; the ref carries the flag)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const created = await bridge.createTable({ name: "Tags-enum", system: true }, ctx());
    const id = created.result.id;
    // The hidden stand: the consumer's catalog reads it out.
    expect(await bridge.listTables()).toEqual([]);
    // The schema / rows stay reachable by id (the grid's ref read).
    const description = await bridge.describeTable(id);
    expect(description.table.name).toBe("Tags-enum");
    expect(created.result.system).toBe(true);
    // The non-system table stands in the catalog (the flag stands the
    // enum's dict, not every table).
    const visible = await bridge.createTable({ name: "Visible" }, ctx());
    expect((await bridge.listTables()).map((table) => table.id)).toEqual([visible.result.id]);
  });
  it("the enum's create form stands the options' editor (the reordering, the colors, the delete; the system table's commit)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='enum']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='enum']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    // The options' editor stands (the ref table's pick is out for the enum).
    const form = () => document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-form']")!;
    expect(form().querySelector("[data-slot='docblocks/database-enum-options']")).not.toBeNull();
    expect(form().querySelector("[data-slot='docblocks/database-add-column-ref']")).toBeNull();
    // The name's prefill stands the type's label (the "Enum" stand).
    expect(form().querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!.value).toBe(
      "Enum"
    );

    const addOption = async (name: string) => {
      fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-add']")!);
      await settleGrid();
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']");
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: name } });
      await settleGrid();
    };
    await addOption("alpha");
    await addOption("beta");
    await addOption("gamma");

    // The reorder stands the framer's session (the Editor's slot provides
    // the motion's options' editor over the plain's pointer's session) —
    // the grip's live reorder over the synthetic events stands the e2e
    // suite's stand, not this jsdom's.

    // The delete's control drops the draft's row (the beta's — the middle
    // over the add's order).
    const deletes = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-delete']");
    fireEvent.click(deletes[1]!);
    await settleGrid();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      )
    ).toEqual(["alpha", "gamma"]);

    // The color's stand (the palette's popover pick over the swatch): the
    // palette's popover stands portaled (the swatch's buttons stand the
    // background color's inline stand — the palette's red). The swatch's
    // zero padding stands the circle's stand (the flex row's min-content
    // clamp over the Button's default padding would stand the oval).
    const swatch = () => document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-color']")!;
    expect(swatch().className).toContain("p-0");
    expect(swatch().className).toContain("size-4");
    expect(swatch().className).toContain("rounded-full");
    fireEvent.click(swatch());
    await settleGrid();
    const paletteButtons = [...document.querySelectorAll<HTMLElement>("button")].filter(
      (button) => button.style.backgroundColor === "rgb(247, 168, 168)"
    );
    expect(paletteButtons.length).toBeGreaterThan(0);
    fireEvent.click(paletteButtons.at(-1)!);
    await settleGrid();
    expect(swatch().getAttribute("data-color")).toBe("#f7a8a8");
    // The pick's stand: the palette's popover closes (the picker stands no
    // hanging over the apply) — the ported palette's group stands gone.
    expect(document.querySelector('[role="group"][aria-label="option color"]')).toBeNull();

    // The create's commit (the button's press): the system table's creation
    // + the options' rows + the column's reference over the hidden table.
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!, {
      target: { value: "Stage" },
    });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(async () => (await bridge.describeTable(tableId)).columns.length === 5, "the column");
    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.name === "Stage");
    expect(created).toBeDefined();
    // The wire's reference stand (the cell holds the option's row id).
    expect(created!.reference).toMatchObject({ kind: "enum", many: false });
    const enumTableId = created!.reference!.tableId;
    // The hidden table stands the catalog out (the options are reachable
    // by id only).
    expect((await bridge.listTables()).map((table) => table.id)).not.toContain(enumTableId);
    // The options' rows stand the ordered page (the labels / the colors
    // over the named columns' ids).
    const enumSchema = await bridge.describeTable(enumTableId);
    const nameColId = enumSchema.columns.find((column) => column.name === ENUM_OPTION_NAME_COLUMN)!.id;
    const colorColId = enumSchema.columns.find((column) => column.name === ENUM_OPTION_COLOR_COLUMN)!.id;
    const enumPage = await bridge.snapshotTable(enumTableId, {});
    expect(enumPage.page.rows.map((row) => row.cells[nameColId])).toEqual(["alpha", "gamma"]);
    expect(enumPage.page.rows[0]!.cells[colorColId]).toBe("#f7a8a8");
  });
});
