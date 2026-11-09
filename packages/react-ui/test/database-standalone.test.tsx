// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BridgeError, DatabaseTable, useTableList } from "../src";
import type { DatabaseBridge, MutationContext, TableRef } from "../src";
import { newMutationContext } from "../src/database/use-database-table";

// The radix primitives drive the grid's interactions through the
// pointer-capture API (setPointerCapture / hasPointerCapture), which jsdom
// does not implement. The stubs keep the gestures testable in the unit
// suite (the database block suite's parity).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/** Waits for the grid's async load to settle (the ready phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Seeds the bridge's table: the text + the integer columns + one row. */
async function seedTable(bridge: DatabaseBridge): Promise<{ tableId: string; title: string; count: string }> {
  const tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const title = (
    await bridge.createColumn(tableId, { column: { name: "Title", type: "text", position: 0, nullable: false } }, ctx())
  ).result.id;
  const count = (
    await bridge.createColumn(
      tableId,
      { column: { name: "Count", type: "integer", position: 1, nullable: false } },
      ctx()
    )
  ).result.id;
  await bridge.batchRows(
    tableId,
    { ops: [{ op: "create", row: { [title]: "Hello", [count]: 42 }, beforeRowId: null }] },
    ctx()
  );
  return { tableId, title, count };
}

describe("useTableList (the catalog's read + the create / rename's mutations)", () => {
  it("the catalog's read + the own's mutations' auto-refresh + the manual's refresh", async () => {
    const bridge = createMemoryDatabaseBridge();
    const seeded = (await bridge.createTable({ name: "Seeded" }, ctx())).result;

    const { result } = renderHook(() => useTableList(bridge));
    expect(result.current.tables).toBeNull();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tables).toEqual([seeded]);
    expect(result.current.error).toBeNull();

    // The create: the fresh's operationId per op; the catalog's auto-refresh
    // stands the new table's entry.
    let created: TableRef;
    await act(async () => {
      created = await result.current.create("Created");
    });
    expect(created!.name).toBe("Created");
    await waitFor(() => expect(result.current.tables?.map((entry) => entry.name)).toEqual(["Seeded", "Created"]));

    // The rename: the same's stand.
    await act(async () => {
      await result.current.rename(created!.id, "Renamed");
    });
    await waitFor(() => expect(result.current.tables?.map((entry) => entry.name)).toEqual(["Seeded", "Renamed"]));

    // The external's mutation stands the catalog unchanged (the contract's
    // catalog stands no push) — the manual's refresh re-reads it.
    await bridge.createTable({ name: "External" }, ctx());
    expect(result.current.tables?.map((entry) => entry.name)).toEqual(["Seeded", "Renamed"]);
    await act(async () => {
      await result.current.refresh();
    });
    await waitFor(() =>
      expect(result.current.tables?.map((entry) => entry.name)).toEqual(["Seeded", "Renamed", "External"])
    );
  });

  it("the catalog's error stand over the failed read", async () => {
    const bridge = createMemoryDatabaseBridge();
    const failing = new Proxy(bridge, {
      get(target, prop, receiver) {
        if (prop === "listTables")
          return () => Promise.reject(new BridgeError("unavailable", "the catalog's read failed"));
        return Reflect.get(target, prop, receiver);
      },
    }) as DatabaseBridge;

    const { result } = renderHook(() => useTableList(failing));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tables).toBeNull();
    expect(result.current.error?.code).toBe("unavailable");
  });
});

describe("DatabaseTable (the standalone's grid over the bridge's table id)", () => {
  it("stands the bridge's schema + rows (the block's grid's parity)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title, count } = await seedTable(bridge);

    render(<DatabaseTable bridge={bridge} tableId={tableId} />);
    for (let i = 0; i < 4; i++) await settleGrid();

    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Tasks");
    expect(
      document.querySelector(`[data-slot='docblocks/database-header-cell'][data-column-id='${title}']`)?.textContent
    ).toContain("Title");
    expect(
      document.querySelector(`[data-slot='docblocks/database-cell'][data-column-id='${title}']`)?.textContent
    ).toBe("Hello");
    expect(
      document.querySelector(`[data-slot='docblocks/database-cell'][data-column-id='${count}']`)?.textContent
    ).toBe("42");
  });

  it("the cell's edit commits to the bridge (the data's truth)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title, count } = await seedTable(bridge);

    render(<DatabaseTable bridge={bridge} tableId={tableId} />);
    await settleGrid();
    await settleGrid();

    const cell = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-cell'][data-column-id='${count}']`
    )!;
    expect(cell).not.toBeNull();
    fireEvent.doubleClick(cell);
    await settleGrid();
    const input = cell.querySelector<HTMLInputElement>("[data-slot='docblocks/database-cell-input']");
    expect(input).not.toBeNull();
    await act(async () => {
      fireEvent.change(input!, { target: { value: "7" } });
    });
    await act(async () => {
      fireEvent.blur(input!);
    });

    const snapshot = await bridge.snapshotTable(tableId, {});
    const row = snapshot.page.rows.find((entry) => entry.cells[title] === "Hello");
    expect(row).toBeDefined();
    expect(row?.cells[count]).toBe(7);
  });

  it("the view's seed stands the initial state (the hidden column's stand off)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title, count } = await seedTable(bridge);

    render(<DatabaseTable bridge={bridge} tableId={tableId} view={{ hiddenColumns: [count] }} />);
    for (let i = 0; i < 4; i++) await settleGrid();

    expect(
      document.querySelector(`[data-slot='docblocks/database-header-cell'][data-column-id='${title}']`)
    ).not.toBeNull();
    expect(
      document.querySelector(`[data-slot='docblocks/database-header-cell'][data-column-id='${count}']`)
    ).toBeNull();
    expect(document.querySelector(`[data-slot='docblocks/database-cell'][data-column-id='${count}']`)).toBeNull();
  });

  it("the header's drag's commit stands the onViewChange's patch (the internal state's merge)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title, count } = await seedTable(bridge);
    const onViewChange = vi.fn();

    render(<DatabaseTable bridge={bridge} tableId={tableId} onViewChange={onViewChange} />);
    for (let i = 0; i < 4; i++) await settleGrid();

    const header = () =>
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-header-cell'][data-column-id='${title}']`);
    const order = () =>
      [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")].map(
        (cell) => cell.dataset.columnId
      );
    expect(order()).toEqual([title, count]);

    // The press + the drag past the threshold + the release: the patch
    // stands the committed order (the jsdom's zero rects' stand: the drop
    // stands past the last stationary column).
    fireEvent.pointerDown(header()!, { clientX: 100, clientY: 5 });
    fireEvent.pointerMove(header()!, { clientX: 160, clientY: 5 });
    expect(onViewChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(header()!, { clientX: 160, clientY: 5 });
    await settleGrid();

    expect(onViewChange).toHaveBeenCalledTimes(1);
    expect(onViewChange.mock.calls[0]![0]).toEqual({ columnOrder: [count, title] });
    // The internal state's merge stands the re-render (the header's order
    // follows the patch).
    expect(order()).toEqual([count, title]);
  });

  it("the readOnly's stand: the cell's edit session stands off", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title } = await seedTable(bridge);

    render(<DatabaseTable bridge={bridge} tableId={tableId} readOnly />);
    for (let i = 0; i < 4; i++) await settleGrid();

    const cell = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-cell'][data-column-id='${title}']`
    )!;
    expect(cell).not.toBeNull();
    fireEvent.doubleClick(cell);
    await settleGrid();
    expect(cell.querySelector("[data-slot='docblocks/database-cell-input']")).toBeNull();
  });
});
