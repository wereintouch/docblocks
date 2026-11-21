// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import type { DatabaseBridge, MutationReceipt, TableRef } from "../src/database/bridge";
import { DatabaseSlashPicker } from "../src/editing/slash/DatabaseSlashPicker";
import { EditorProvider } from "../src/editor-provider";

// the slash Database picker spec — part 1 of 1.

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

/** Waits for the grid's async load to settle (the ready / broken phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => cleanup());

describe("the slash Database picker (the rework: the create form + the search)", () => {
  /** A bridge with two seeded tables + a spied `createTable`. */
  function mockBridge() {
    const tables: TableRef[] = [
      { id: "t-demo", name: "Demo", revision: "rev-1" },
      { id: "t-zebra", name: "Zebra Board", revision: "rev-1" },
    ];
    const base = createMemoryDatabaseBridge();
    const createTable = vi.fn(
      async (input: { name: string; system?: boolean }): Promise<MutationReceipt<TableRef>> => ({
        operationId: "op-pick",
        txId: "tx-pick",
        committedSeq: 1,
        result: { id: `t-${input.name.toLowerCase().replace(/\s+/g, "-")}`, name: input.name, revision: "rev-1" },
        revisions: {},
      })
    );
    const bridge: DatabaseBridge = { ...base, listTables: async () => tables, createTable };
    return { bridge, createTable };
  }

  function renderPicker(bridge: DatabaseBridge, onCommit = vi.fn(), onCancel = vi.fn()) {
    const doc = createDoc({ id: "doc-pick", createdAt: CREATED_AT });
    render(
      <EditorProvider doc={doc} databaseBridge={bridge}>
        <DatabaseSlashPicker onCommit={onCommit} onCancel={onCancel} />
      </EditorProvider>
    );
    return { onCommit, onCancel };
  }

  /** The picker's slot (an optional `data-table-id` filter). */
  const slot = (name: string, tableId?: string) =>
    document.querySelector(
      tableId === undefined
        ? `[data-slot='docblocks/${name}']`
        : `[data-slot='docblocks/${name}'][data-table-id="${tableId}"]`
    );

  it("the create button stands the auto-focused form (the name input + the check)", async () => {
    const { bridge } = mockBridge();
    renderPicker(bridge);
    await settleGrid();
    // The create-new button stands at rest; the form is hidden.
    expect(slot("slash-database-create-new")).not.toBeNull();
    expect(slot("slash-database-name")).toBeNull();
    // The click stands the form: the name input (focused) + the check.
    fireEvent.click(slot("slash-database-create-new")!);
    await settleGrid();
    const nameInput = slot("slash-database-name")!;
    expect(nameInput).not.toBeNull();
    expect(document.activeElement).toBe(nameInput);
    expect(slot("slash-database-create")).not.toBeNull();
  });
  it("the empty name is a no-op (the check is disabled, the Enter commits nothing)", async () => {
    const { bridge, createTable } = mockBridge();
    const { onCommit } = renderPicker(bridge);
    await settleGrid();
    fireEvent.click(slot("slash-database-create-new")!);
    await settleGrid();
    expect((slot("slash-database-create") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(slot("slash-database-name")!, { key: "Enter" });
    await settleGrid();
    expect(createTable).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
  });
  it("the Enter on the name commits (the createTable + the onCommit)", async () => {
    const { bridge, createTable } = mockBridge();
    const { onCommit } = renderPicker(bridge);
    await settleGrid();
    fireEvent.click(slot("slash-database-create-new")!);
    await settleGrid();
    const nameInput = slot("slash-database-name")!;
    fireEvent.change(nameInput, { target: { value: "My Board" } });
    expect((slot("slash-database-create") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await settleGrid();
    // The create stands the contract's input + the fresh mutation context (the
    // client-issued idempotency key).
    expect(createTable).toHaveBeenCalledWith({ name: "My Board" }, expect.anything());
    expect(onCommit).toHaveBeenCalledWith("t-my-board");
  });
  it("the protocol mismatch stands the error line (no list, the create stands blocked)", async () => {
    const { bridge, createTable } = mockBridge();
    const descriptor = await bridge.describeProtocol();
    const badBridge: DatabaseBridge = {
      ...bridge,
      describeProtocol: async () => ({ ...descriptor, protocolVersion: 1 as unknown as 2 }),
    };
    renderPicker(badBridge);
    await settleGrid();
    // The negotiation stand (the useDatabaseTable bootstrap's contract):
    // the version mismatch stands the protocol_mismatch — the error line,
    // the list stands not loaded.
    expect(slot("slash-database-error")).not.toBeNull();
    expect(slot("slash-database-list")).toBeNull();
    // The create stands blocked (the unvalidated bridge): the Enter commits
    // nothing (the createTable is not reached over the failed negotiation).
    fireEvent.click(slot("slash-database-create-new")!);
    await settleGrid();
    const nameInput = slot("slash-database-name")!;
    fireEvent.change(nameInput, { target: { value: "My Board" } });
    await settleGrid();
    fireEvent.keyDown(nameInput, { key: "Enter" });
    await settleGrid();
    expect(createTable).not.toHaveBeenCalled();
  });
  it("the check button commits (the same as the Enter)", async () => {
    const { bridge, createTable } = mockBridge();
    const { onCommit } = renderPicker(bridge);
    await settleGrid();
    fireEvent.click(slot("slash-database-create-new")!);
    await settleGrid();
    const nameInput = slot("slash-database-name")!;
    fireEvent.change(nameInput, { target: { value: "My Board" } });
    fireEvent.click(slot("slash-database-create")!);
    await settleGrid();
    expect(createTable).toHaveBeenCalledWith({ name: "My Board" }, expect.anything());
    expect(onCommit).toHaveBeenCalledWith("t-my-board");
  });
  it("the search filters the existing tables by name (case-insensitive)", async () => {
    const { bridge } = mockBridge();
    renderPicker(bridge);
    await settleGrid();
    // Both tables stand at rest.
    expect(slot("slash-database-table", "t-demo")).not.toBeNull();
    expect(slot("slash-database-table", "t-zebra")).not.toBeNull();
    // The query filters (case-insensitive).
    const search = slot("slash-database-search")!;
    fireEvent.change(search, { target: { value: "zebra" } });
    expect(slot("slash-database-table", "t-zebra")).not.toBeNull();
    expect(slot("slash-database-table", "t-demo")).toBeNull();
    // The non-matching query stands the empty stand.
    fireEvent.change(search, { target: { value: "no-such-table" } });
    expect(slot("slash-database-table", "t-zebra")).toBeNull();
    expect(slot("slash-database-empty")).not.toBeNull();
  });
  it("the unmount over the in-flight create cancels the commit (the block is not inserted over the cancelled gesture)", async () => {
    // The create resolves after the picker unmounts (the Escape / the
    // caret's move closed the menu): the commit must not run over the
    // cancelled gesture (the create's receipt stands the consumer's
    // orphan, the picker cannot unwind it).
    let releaseCreate: () => void = () => {};
    const { bridge, createTable } = mockBridge();
    const slowBridge: DatabaseBridge = {
      ...bridge,
      createTable: async (input: Parameters<typeof createTable>[0]) => {
        await new Promise<void>((resolve) => {
          releaseCreate = () => resolve();
        });
        return createTable(input);
      },
    };
    const doc = createDoc({ id: "doc-pick", createdAt: CREATED_AT });
    const onCommit = vi.fn();
    const result = render(
      <EditorProvider doc={doc} databaseBridge={slowBridge}>
        <DatabaseSlashPicker onCommit={onCommit} onCancel={vi.fn()} />
      </EditorProvider>
    );
    await settleGrid();
    // Open the form, type the name, commit — the create is in flight.
    fireEvent.click(slot("slash-database-create-new")!);
    fireEvent.change(slot("slash-database-name")!, { target: { value: "Ghost" } });
    fireEvent.keyDown(slot("slash-database-name")!, { key: "Enter" });
    // The picker unmounts over the in-flight create (the Escape's stand).
    result.unmount();
    act(() => {
      releaseCreate();
    });
    await settleGrid();
    expect(createTable).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
