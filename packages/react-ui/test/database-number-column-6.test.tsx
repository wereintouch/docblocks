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

// the number column spec — part 6 of 6.

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
  it("the menu's entry stands the create form (the name over the create; the type's attributes stand none)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='text']") !== null, "the add-column menu");
    // The Text entry stands the form (not the immediate create): the name
    // input prefills the type's label, the number's attribute fields stand
    // none (the type-specific block stands for the number / the ref).
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='text']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    const name = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!;
    expect(name.value).toBe("Text");
    expect(document.querySelector("[data-slot='docblocks/database-add-column-decimals']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-ref']")).toBeNull();
    // The name from the input stands the column's name over the create.
    fireEvent.change(name, { target: { value: "Notes" } });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(async () => (await bridge.describeTable(tableId)).columns.length === 5, "the column's create");

    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.name === "Notes");
    expect(created).toMatchObject({ name: "Notes", type: "text", position: 4, nullable: true });
    // The form closes over the create's commit (the failure stands it open).
    await until(
      () => document.querySelector("[data-slot='docblocks/database-add-column-form']") === null,
      "the form's close"
    );
  });
  it("the empty name stands the disabled create (the commit is impossible over it)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='text']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='text']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    const name = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!;
    fireEvent.change(name, { target: { value: "" } });
    const create = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/database-add-column-create']")!;
    expect(create.disabled).toBe(true);
    // The press over the disabled button stands no create (the form stands).
    fireEvent.click(create);
    await settleGrid();
    expect((await bridge.describeTable(tableId)).columns).toHaveLength(4);
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).not.toBeNull();
  });
  it("the Escape over the form closes without the create", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='date']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='date']")!);
    const form = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-form']");
    await until(() => form !== null, "the form");
    // The Escape stands the close (the outside press stands it too) — no
    // create on either (the commit stands the form's button only).
    fireEvent.keyDown(form!, { key: "Escape", bubbles: true });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).toBeNull();
    expect((await bridge.describeTable(tableId)).columns).toHaveLength(4);
  });
});
