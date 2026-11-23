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

// the cell interaction spec — part 4 of 5.

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

describe("the cell interaction (the selection, the edit, the multi-select clear)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  it("the Ctrl+C copies the selection's rectangle as TSV (the paste's round-trip stand)", async () => {
    await renderGrid();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    // The single cell's copy (the value's flat stand: the tab / the
    // newline stand the space, the boolean stands its "true" / "false").
    const cell = cellOf(0, 0)!;
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(cell, { clientX: 10, clientY: 5 });
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "c", ctrlKey: true, bubbles: true });
    await settleGrid();
    expect(writeText).toHaveBeenCalledWith("a");
    writeText.mockClear();
    // The region's copy (the 2x2 over the drag): the rows top → bottom,
    // the cells left → right.
    const b = cellOf(1, 1)!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => b;
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(cell, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(cell, { clientX: 60, clientY: 60 });
    document.elementFromPoint = original;
    await settleGrid();
    fireEvent.keyDown(table!, { key: "c", ctrlKey: true, bubbles: true });
    await settleGrid();
    expect(writeText).toHaveBeenCalledWith("a\t1\nb\t2");
    // The no-selection stands no copy.
    fireEvent.keyDown(table!, { key: "Escape", bubbles: true });
    await settleGrid();
    writeText.mockClear();
    fireEvent.keyDown(table!, { key: "c", ctrlKey: true, bubbles: true });
    expect(writeText).not.toHaveBeenCalled();
  });
  it("the paste stands the spec's batch (the visible rows' updates + the overflow's creates; the one undo)", async () => {
    const { bridge, tableId, cols } = await renderGrid(); // 2 rows: a / b
    // The selection over the (0,0) — the paste's origin.
    const cell = cellOf(0, 0)!;
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(cell, { clientX: 10, clientY: 5 });
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    // 3 values over the 2 loaded rows: the 2 updates + the 1 create.
    fireEvent.paste(table!, { clipboardData: { getData: () => "№1\n№2\n№3" } });
    await until(async () => (await bridge.snapshotTable(tableId, {})).page.rows.length === 3, "the created row");
    const page = await bridge.snapshotTable(tableId, {});
    expect(page.page.rows[0]!.cells[cols.title]).toBe("№1");
    expect(page.page.rows[1]!.cells[cols.title]).toBe("№2");
    expect(page.page.rows[2]!.cells[cols.title]).toBe("№3");
    // The overflow row's other cells stand null (the create's empty stand).
    expect(page.page.rows[2]!.cells[cols.n] ?? null).toBeNull();
    // The one undo: the updates' restore + the created row's deletion (the
    // button's arm stands over the undo entry's render — the bridge's state
    // stands earlier).
    await until(
      () =>
        document.querySelector<HTMLElement>("[data-slot='docblocks/database-undo']")?.hasAttribute("disabled") !== true,
      "the undo's arm"
    );
    const undo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-undo']");
    fireEvent.click(undo!);
    await until(async () => (await bridge.snapshotTable(tableId, {})).page.rows.length === 2, "the undo");
    const restored = (await bridge.snapshotTable(tableId, {})).page.rows;
    expect(restored[0]!.cells[cols.title]).toBe("a");
    expect(restored[1]!.cells[cols.title]).toBe("b");
  });
});
