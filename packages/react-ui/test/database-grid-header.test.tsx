// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { DatabaseBlock } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the grid's header spec — part 1 of 12.

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

describe("the grid's header (the table's name, the column menu, the column drag)", () => {
  it("the display name stands the table's name live; the rename commits to the bridge (no doc write)", async () => {
    const { doc, db, bridge, tableId } = await renderGrid();
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Demo");

    // The click opens the rename line (the commit is the blur / the Enter).
    fireEvent.click(document.querySelector("[data-slot='docblocks/database-name']")!);
    const input = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-name-input']");
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "Renamed Tasks" } });
    fireEvent.blur(input!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-name']")?.textContent === "Renamed Tasks",
      "the renamed table's name stands over the table event"
    );
    // The name is the table's attribute: the bridge stands the new name.
    expect((await bridge.describeTable(tableId)).table.name).toBe("Renamed Tasks");
    // The rename is a bridge operation — the block's JSON stands untouched
    // (no `name` attr write).
    expect((doc.getBlock(db) as DatabaseBlock).attrs.name).toBeUndefined();
  });
  it("a legacy block `name` attr stands no display override (the table's name stands)", async () => {
    await renderGrid({ name: "Override" });
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Demo");
  });
  it("the header cell stands the name only (the type stands in the menu, not the row)", async () => {
    const { cols } = await renderGrid();
    const header = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-header-cell'][data-column-id='${cols.title}']`
    );
    expect(header?.textContent).toBe("Title");
    expect(header!.querySelector("[data-slot='docblocks/database-column-type']")).toBeNull();
  });
  it("the header's press stands the menu (the rename line + the read-only type line); the rename commits to the bridge", async () => {
    const { bridge, tableId, cols } = await renderGrid();
    const header = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-header-cell'][data-column-id='${cols.title}']`
    );
    // The Ellipsis's own press stands the menu (the header's name zone's
    // press stands nothing — the menu-open's only trigger is the Ellipsis).
    const ellipsis = header!.querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
    fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
    await until(() => document.querySelector("[data-slot='docblocks/database-rename-input']") !== null, "the menu");
    const menuInput = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']");
    const typeLine = document.querySelector("[data-slot='docblocks/database-column-type']");
    expect(typeLine?.textContent).toBe("text");

    // The rename commits on the blur (the bridge's column stands renamed).
    fireEvent.change(menuInput!, { target: { value: "Headline" } });
    fireEvent.blur(menuInput!);
    await settleGrid();
    const schema = await bridge.describeTable(tableId);
    expect(schema.columns.find((column) => column.id === cols.title)?.name).toBe("Headline");
    expect(
      document.querySelector(`[data-slot='docblocks/database-header-cell'][data-column-id='${cols.title}']`)
        ?.textContent
    ).toBe("Headline");
  });
});
