// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { BridgeError, useTableList } from "../src";
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
