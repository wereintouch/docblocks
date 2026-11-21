// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the datetime cell's draft contract spec — part 5 of 7.

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

describe("the datetime cell's draft contract (the time/date order, the same-day toggle, the mid-session value)", () => {
  // The timestamptz column + the seed value (the draft stands from it at
  // the double-press's open).
  async function renderDateTime() {
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
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${at}']`)!;
    const value = async () => (await cellsOf(bridge, tableId, rowId))[at] ?? null;
    const segments = () => [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    const openPicker = async () => {
      // The real gesture's stand: the press (the grid's session + the
      // selection stand — the document's outside-press handler stands over
      // the selection) + the double press (the picker's open).
      fireEvent.pointerDown(cell(), { button: 0 });
      fireEvent.doubleClick(cell());
      await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    };
    const closeByEnter = async () => {
      // The popover's keys' stand: the Enter commits the draft + closes.
      fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Enter", bubbles: true });
      await settleGrid();
    };
    const cancelByEscape = async () => {
      // The popover's keys' stand: the Escape cancels the draft (no write
      // over the wire — the draft's drop).
      fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
      await settleGrid();
    };
    const closeByTriggerPress = async () => {
      // The trigger's press stands the popover's own close (the radix's
      // onOpenChange commit path).
      fireEvent.click(cell().querySelector("[data-slot='popover-trigger']")!);
      await settleGrid();
    };
    const closeByOutsidePress = async () => {
      // The real outside press's stand: the grid's document-capture press
      // handler clears the session (the popover's `open` stands the grid's
      // state) without the radix's close callback — the cell's teardown
      // stand commits the draft.
      fireEvent.pointerDown(document.body, { button: 0 });
      await settleGrid();
    };
    return {
      bridge,
      tableId,
      rowId,
      at,
      cell,
      value,
      segments,
      openPicker,
      closeByEnter,
      cancelByEscape,
      closeByTriggerPress,
      closeByOutsidePress,
    };
  }

  it("the repeat-commit guard stands per session (a later session re-commits the earlier ISO)", async () => {
    const { bridge, tableId, rowId, at, value, segments, openPicker, closeByEnter } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    await closeByEnter();
    expect(await value()).toBe("2026-10-01T09:30");
    // The peer's write moves the value away (the envelope stream stands the
    // page's refetch); the later session explicitly restores the earlier
    // ISO (the day's pick + the time) — the guard's per-session stand (the
    // open resets it) commits the restore.
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [at]: "2026-10-02T00:00" } }] }, ctx());
    await until(async () => (await value()) === "2026-10-02T00:00", "the peer's value");
    await openPicker();
    const [hours2, minutes2] = segments();
    fireEvent.change(hours2!, { target: { value: "09" } });
    fireEvent.change(minutes2!, { target: { value: "30" } });
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    await closeByEnter();
    expect(await value()).toBe("2026-10-01T09:30");
  });
  it("the mid-session peer's commit stands the conflict (the peer's value stands the draft's commit)", async () => {
    const { bridge, tableId, rowId, at, cell, value, segments, openPicker, closeByEnter } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    // The peer's write over the same cell (the envelope stream's refetch)
    // re-renders the value — the in-flight draft stands (no reset).
    await bridge.batchRows(tableId, { ops: [{ op: "update", rowId, cells: { [at]: "2026-11-11T08:00" } }] }, ctx());
    await until(() => cell().textContent === "11.11.2026 08:00", "the peer's value stand");
    // The draft's date stand: the day's pick over the still-open calendar.
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    await closeByEnter();
    // The draft's commit stands the open-time's pinned revision: the peer's
    // commit advanced the row, so the bridge's conflict rejection stands
    // the peer's value (the draft's commit is no silent overwrite).
    expect(await value()).toBe("2026-11-11T08:00");
    expect(cell().textContent).toContain("11.11.2026 08:00");
  });
});
