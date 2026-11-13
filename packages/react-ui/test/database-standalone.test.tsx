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

  it("the columns popover restores a hidden column and guards the last visible one", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId, title, count } = await seedTable(bridge);
    const onViewChange = vi.fn();

    render(
      <DatabaseTable bridge={bridge} tableId={tableId} view={{ hiddenColumns: [count] }} onViewChange={onViewChange} />
    );
    for (let i = 0; i < 4; i++) await settleGrid();

    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-columns']")!);
    const visibleTitle = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-column-visibility'][data-column-id='${title}']`
    )!;
    const hiddenCount = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-column-visibility'][data-column-id='${count}']`
    )!;
    expect(visibleTitle.getAttribute("data-state")).toBe("checked");
    expect(visibleTitle.hasAttribute("disabled")).toBe(true);
    expect(hiddenCount.getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(hiddenCount);
    await settleGrid();
    expect(onViewChange).toHaveBeenCalledWith({ hiddenColumns: [] });
    expect(
      document.querySelector(`[data-slot='docblocks/database-header-cell'][data-column-id='${count}']`)
    ).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-columns-content']")).not.toBeNull();
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

  it("the root anchors the package's token scope (the standalone stands over the editor root's mapping)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);

    const first = render(<DatabaseTable bridge={bridge} tableId={tableId} />);
    await settleGrid();
    await settleGrid();

    const scope = document.querySelector<HTMLElement>("[data-slot='docblocks/editor']");
    expect(scope).not.toBeNull();
    expect(scope!.getAttribute("data-readonly")).toBeNull();
    // The grid's surface stands inside the scope (the token's cascade's
    // reach over the standalone's utilities).
    expect(scope!.querySelector("[data-slot='docblocks/database']")).not.toBeNull();
    first.unmount();
    cleanup();

    // The read-only's stand: the suppression's attribute (the page mode's
    // parity over the read-only's root).
    render(<DatabaseTable bridge={bridge} tableId={tableId} readOnly />);
    await settleGrid();
    await settleGrid();
    expect(document.querySelector<HTMLElement>("[data-slot='docblocks/editor']")!.getAttribute("data-readonly")).toBe(
      "true"
    );
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

  it("the className's stand over the root + the constrained height's inner scroll's plumbing", async () => {
    const bridge = createMemoryDatabaseBridge();
    const { tableId } = await seedTable(bridge);

    render(<DatabaseTable bridge={bridge} tableId={tableId} className="h-96" />);
    for (let i = 0; i < 4; i++) await settleGrid();

    // The consumer's classes merge over the root (the package's stand's
    // flex-column's stand + the consumer's own).
    const root = document.querySelector<HTMLElement>("[data-slot='docblocks/editor']")!;
    expect(root.className).toContain("h-96");
    expect(root.className).toContain("flex");
    expect(root.className).toContain("flex-col");

    // The grid's chain stands the scroll's plumbing (the constrained's
    // height's stand: the card's fill + the content's shrink + the
    // grid's scroll's region); the unconstrained's context stands the
    // content's height (the e2e's pin over a real layout).
    const card = document.querySelector<HTMLElement>("[data-slot='docblocks/block'][data-state='ready']")!;
    expect(card.className).toContain("flex-1");
    expect(card.className).toContain("min-h-0");
    expect(card.className).toContain("flex-col");
    expect(document.querySelector<HTMLElement>("[data-slot='docblocks/database']")!.className).toContain("min-h-0");
    const grid = document.querySelector<HTMLElement>("[data-slot='docblocks/database-grid']")!;
    expect(grid.className).toContain("flex-1");
    expect(grid.className).toContain("min-h-0");
  });
});
