// @vitest-environment jsdom
// The standalone table's header-row height (the tables-section stand): the
// table's own value comes from the consumer's per-table section settings
// (`getHeaderHeight`) and the grid's drag commits it back over
// (`setHeaderHeight`) — the same value the document blocks over the table
// read; without the contract the grid renders no handle.
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useState } from "react";

import { DatabaseTable } from "../src";
import type { DatabaseBridge, DatabaseTableSection, MutationContext } from "../src";
import { newMutationContext } from "../src/database/use-database-table";

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

/** Seeds a one-column, one-row table (the grid renders the header row). */
async function seedTable(bridge: DatabaseBridge): Promise<string> {
  const tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const title = (
    await bridge.createColumn(tableId, { column: { name: "Title", type: "text", position: 0, nullable: true } }, ctx())
  ).result.id;
  await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [title]: "a" }, beforeRowId: null }] }, ctx());
  return tableId;
}

/** The grid's header-row track stand (the inline style). */
function headerTrack(): string {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']")!.style.gridTemplateRows;
}

function headerHandle(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-resize']");
}

describe("the standalone table's header-row height (the section stand)", () => {
  it("the section's value stands the header track and the drag commits it back", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await seedTable(bridge);
    const setHeaderHeight = vi.fn();
    const tableSection: DatabaseTableSection = {
      getHeaderHeight: (id) => (id === tableId ? 120 : undefined),
      setHeaderHeight,
    };
    render(<DatabaseTable bridge={bridge} tableId={tableId} tableSection={tableSection} />);
    await settleGrid();
    expect(headerTrack()).toBe("120px");

    const handle = headerHandle()!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 140 });
    await settleGrid();
    // One commit over the table id; the grid's own display stands it (the
    // section's interface is a read, not a subscription).
    expect(setHeaderHeight).toHaveBeenCalledTimes(1);
    expect(setHeaderHeight).toHaveBeenCalledWith(tableId, 160);
    expect(headerTrack()).toBe("160px");
  });

  it("without the section contract the grid renders no header handle (no write target)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await seedTable(bridge);
    render(<DatabaseTable bridge={bridge} tableId={tableId} />);
    await settleGrid();
    expect(headerTrack()).toBe("auto");
    expect(headerHandle()).toBeNull();
  });

  it("the consumer's section store drives the display (the commit's echo drops over any other value)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await seedTable(bridge);

    // The consumer's store stand: `setHeaderHeight` re-renders the grid with
    // the fresh `getHeaderHeight` value (the section's interface is a read);
    // `setExternal` stands a change made outside this grid (the `undefined`
    // stands the clear — the double-click's reset's stand).
    const heights = new Map<string, number>([[tableId, 120]]);
    let setExternal: (height: number | undefined) => void = () => undefined;
    function Section() {
      const [, setTick] = useState(0);
      setExternal = (height) => {
        if (height === undefined) heights.delete(tableId);
        else heights.set(tableId, height);
        setTick((tick) => tick + 1);
      };
      const section: DatabaseTableSection = {
        getHeaderHeight: (id) => heights.get(id),
        setHeaderHeight: (_id, height) => setExternal(height),
      };
      return <DatabaseTable bridge={bridge} tableId={tableId} tableSection={section} />;
    }
    render(<Section />);
    await settleGrid();
    expect(headerTrack()).toBe("120px");

    const handle = headerHandle()!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 140 });
    await settleGrid();
    // The consumer's persisted value stands (the same commit the echo held).
    expect(heights.get(tableId)).toBe(160);
    expect(headerTrack()).toBe("160px");

    // A change made outside this grid applies: the commit's echo never
    // masks the consumer's stand.
    await act(async () => {
      setExternal(200);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(headerTrack()).toBe("200px");
  });

  it("the double click over the grid resets the section's value (the auto's return)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await seedTable(bridge);
    const setHeaderHeight = vi.fn();
    const tableSection: DatabaseTableSection = {
      getHeaderHeight: (id) => (id === tableId ? 120 : undefined),
      setHeaderHeight,
    };
    render(<DatabaseTable bridge={bridge} tableId={tableId} tableSection={tableSection} />);
    await settleGrid();
    expect(headerTrack()).toBe("120px");

    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-cell']");
    expect(cell).not.toBeNull();
    fireEvent.dblClick(cell!);
    await settleGrid();
    // The clear's commit over the table id (the `undefined`'s stand);
    // the local echo stands the display (the section's read stands until
    // the consumer's value lands).
    expect(setHeaderHeight).toHaveBeenCalledTimes(1);
    expect(setHeaderHeight).toHaveBeenCalledWith(tableId, undefined);
    expect(headerTrack()).toBe("auto");
  });

  it("the double click over the auto's stand stands no write (the section's value's absence)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await seedTable(bridge);
    const setHeaderHeight = vi.fn();
    render(<DatabaseTable bridge={bridge} tableId={tableId} tableSection={{ setHeaderHeight }} />);
    await settleGrid();
    expect(headerTrack()).toBe("auto");

    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-cell']");
    fireEvent.dblClick(cell!);
    await settleGrid();
    expect(setHeaderHeight).not.toHaveBeenCalled();
    expect(headerTrack()).toBe("auto");
  });
});
