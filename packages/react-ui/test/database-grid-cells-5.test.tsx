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

// the grid's cells spec — part 5 of 5.

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

afterEach(() => cleanup());

describe("the grid's cells (the type editors)", () => {
  it("the seam release stands the untouched's start measurement (the preview's lock stands the commit's source)", async () => {
    // The one-shot stand: over the fresh block (no columnWidths) the drag's
    // preview locks the flexible (1fr) columns over their start's
    // measurement; the release must stand the same measurement (the
    // pre-drag layout) — not a re-measurement over the drag's layout.
    const { doc, db } = await renderGrid();
    const dbAttrs = () => (doc.getBlock(db) as DatabaseBlock | null)?.attrs ?? {};
    const headers = Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']"));
    expect(headers.length).toBe(4);
    // The jsdom's offsetWidth stands the layout's stand: the 200 px stand
    // at the press, the preview's shrink stand (100) over the drag.
    let liveWidth = 200;
    for (const header of headers) {
      Object.defineProperty(header, "offsetWidth", { configurable: true, get: () => liveWidth });
    }
    const seam = document.querySelector<HTMLElement>("[data-slot='docblocks/database-col-resize'][data-index='0']")!;
    fireEvent.pointerDown(seam, { clientX: 100, clientY: 5 });
    fireEvent.pointerMove(seam, { clientX: 160, clientY: 5 }); // the +60 px delta
    liveWidth = 100; // the flex's columns' shrink over the preview
    fireEvent.pointerUp(seam, { clientX: 160, clientY: 5 });
    await settleGrid();
    // The dragged's stand (the start's 200 + 60), the untouched's start's
    // stand (200 — not the live's 100).
    expect(dbAttrs().columnWidths).toEqual([260, 200, 200, 200]);
  });
  it("the datetime cell stands the calendar + the time on the double press (the Enter commits the ISO date-time)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = await firstRowId(bridge, tableId);
    const at = (
      await bridge.createColumn(
        tableId,
        { column: { name: "At", type: "timestamptz", position: 4, nullable: true } },
        ctx()
      )
    ).result.id;
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [at]: "2026-10-01T18:00" } }] }, ctx());
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${at}']`);
    // The cell stands the display (the compact date + time), not a native
    // <input type="datetime-local"> and no trigger chrome: the calendar +
    // the time box open on the double press over the cell itself.
    expect(cell()!.tagName).toBe("DIV");
    expect(cell()!.textContent).toContain("01.10.2026 18:00");

    // The pick + the time: the calendar stands in the portal, the day click
    // + the minutes stand the draft, the Enter commits the ISO string +
    // closes (the popover's keys' stand).
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
    await settleGrid();
    expect((await cellsOf(bridge, tableId, rowId))[at]).toBe("2026-10-05T18:30");
    expect(cell()!.textContent).toContain("05.10.2026 18:30");
  });
});
