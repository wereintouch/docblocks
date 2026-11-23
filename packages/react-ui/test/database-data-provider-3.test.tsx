// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import type { DatabaseBridge, MutationContext, PageQuery, QuerySemantics } from "../src/database/bridge";
import { newMutationContext, useDatabaseTable } from "../src/database/use-database-table";

// the data provider spec — part 3 of 3.

// The radix Select drives the cell's pick through the pointer-capture API
// (setPointerCapture / hasPointerCapture), which jsdom does not implement.
// The stub keeps the open/pick gesture testable in the unit suite.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
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

afterEach(() => cleanup());

describe("the data provider (the useDatabaseTable's batch commit)", () => {
  const SEMANTICS: QuerySemantics = {
    semanticsVersion: "test",
    collation: "undecoded",
    timezone: "UTC",
    nullOrdering: "last",
    operatorsByColumnType: {},
  };

  it("a superseded load's reject keeps the retried ready grid (the stale error stands no state)", async () => {
    const base = createMemoryDatabaseBridge();
    const tableId = (await base.createTable({ name: "Stale" }, ctx())).result.id;
    // Each snapshotTable call holds on its own gate: the first (the initial
    // load) stays pending until the test rejects it, the second (the
    // retry's load) resolves and stands the ready state.
    const gates: Array<{ p: Promise<void>; resolve: () => void; reject: (error: Error) => void }> = [];
    const bridge: DatabaseBridge = {
      ...base,
      snapshotTable: (id: string, query: PageQuery) => {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const p = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        gates.push({ p, resolve, reject });
        return p.then(() => base.snapshotTable(id, query));
      },
      // The subscription stands a noop handle (the replay's stand is out of
      // the gate's scope — the test pins the load's token, not the stream).
      subscribeTable: () => ({ unsubscribe: () => undefined }),
    };
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => gates.length === 1, "the initial load's request");
    expect(result.current.phase).toBe("loading");
    // The retry stands the second load.
    await act(async () => {
      result.current.retry();
    });
    await until(() => gates.length === 2, "the retry's request");
    await act(async () => {
      gates[1]!.resolve();
    });
    await until(() => result.current.phase === "ready", "the retry's load");
    // The initial load's reject lands AFTER the retry's ready.
    await act(async () => {
      gates[0]!.reject(new Error("the stale failure"));
    });
    expect(result.current.phase).toBe("ready");
    expect(result.current.error).toBeNull();
  });
  it("a loadMore pending over a relink drops the stale page (no cross-table rows, no stale error)", async () => {
    const base = createMemoryDatabaseBridge();
    // Two tables; the provider's pagination stands synthesized (two rows
    // per page), so the second page is a controllable pending request.
    const aId = (await base.createTable({ name: "Stale-A" }, ctx())).result.id;
    const bId = (await base.createTable({ name: "Stale-B" }, ctx())).result.id;
    for (const id of [aId, bId]) {
      await base.createColumn(id, { column: { name: "T", type: "text", position: 0, nullable: true } }, ctx());
    }
    const data: Record<string, Array<{ id: string; t: string }>> = {
      [aId]: [
        { id: "ra1", t: "a-1" },
        { id: "ra2", t: "a-2" },
        { id: "ra3", t: "a-3" },
      ],
      [bId]: [
        { id: "rb1", t: "b-1" },
        { id: "rb2", t: "b-2" },
        { id: "rb3", t: "b-3" },
      ],
    };
    const nameOf = (id: string) => (id === aId ? "Stale-A" : "Stale-B");
    let gateResolve!: () => void;
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve;
    });
    const pageOfTable = (id: string, page: number) => ({
      rows: data[id]!.slice(page * 2, page * 2 + 2).map((entry, index) => ({
        id: entry.id,
        orderKey: page * 2 + index + 1,
        revision: "rev-1",
        cells: { t: entry.t },
      })),
      nextCursor: page * 2 + 2 < data[id]!.length ? "c" + (page + 1) : null,
      asOfSeq: 0,
      schemaRevision: "rev-1",
      queryFingerprint: "fp-test",
      semantics: SEMANTICS,
    });
    const bridge: DatabaseBridge = {
      ...base,
      snapshotTable: async (id: string) => ({
        table: { id, name: nameOf(id), revision: "rev-1" },
        columns: [{ id: "t", name: "T", type: "text", position: 0, nullable: true, revision: "rev-1" }],
        schemaRevision: "rev-1",
        page: pageOfTable(id, 0),
      }),
      queryNextPage: async (id: string) => {
        // Table A's second page holds on the gate until the test releases it.
        if (id === aId) await gate;
        return pageOfTable(id, 1);
      },
      subscribeTable: () => ({ unsubscribe: () => undefined }),
    };
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDatabaseTable(bridge, id), {
      initialProps: { id: aId },
    });
    await until(
      () => result.current.phase === "ready" && result.current.nextCursor !== null,
      "the page one + the cursor"
    );
    await act(async () => {
      void result.current.loadMore();
    });
    // The relink while the page is pending.
    await act(async () => {
      rerender({ id: bId });
    });
    await until(() => result.current.table?.name === "Stale-B", "the reloaded table B");
    await act(async () => {
      gateResolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The stale page stands no state: B's rows only, B's cursor, no error.
    expect(result.current.rows.map((row) => row.cells.t)).toEqual(["b-1", "b-2"]);
    expect(result.current.nextCursor).toBe("c1");
    expect(result.current.error).toBeNull();
  });
});
