// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// The column's rename's contract (the `InlineEditInput`'s stand over the
// header's menu): the field's focus + the select-all over the open, the
// commit over the Enter / the blur (one write — the committed-once's guard),
// the reseed over an open edit (the pristine's follow, the typed's keep),
// the Escape's cancel, and the no-op's guard (the empty / the unchanged's
// no-write).

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

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

/** The grid's settle over the stream's refetch (the envelope's delivery). */
async function settleGrid(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Seeds one table (two text columns + one row) and renders the grid over it. */
async function renderGrid() {
  const bridge = createMemoryDatabaseBridge();
  const table = await bridge.createTable({ name: "Rename Table" }, ctx());
  const tableId = table.result.id;
  const first = await bridge.createColumn(
    tableId,
    { column: { name: "Title", type: "text", position: 0, nullable: true } },
    ctx()
  );
  const second = await bridge.createColumn(
    tableId,
    { column: { name: "Note", type: "text", position: 1, nullable: true } },
    ctx()
  );
  await bridge.batchRows(
    tableId,
    { ops: [{ op: "create", row: { [first.result.id]: "Row one", [second.result.id]: "cell" }, beforeRowId: null }] },
    ctx()
  );
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  doc.insertBlock("database", { tableId });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  await until(() => document.querySelector("[data-slot='docblocks/database-name']") !== null, "the grid's ready stand");
  return { bridge, tableId, titleColId: first.result.id };
}

/** Opens the first column's menu (the Ellipsis's own press). */
async function openMenu(): Promise<HTMLInputElement> {
  const header = document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-cell']");
  const ellipsis = header!.querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
  fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
  await until(() => document.querySelector("[data-slot='docblocks/database-rename-input']") !== null, "the menu");
  return document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']")!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the column's rename (the header's menu's inline edit)", () => {
  it("the open stands the field's focus + the select-all (a keystroke replaces the name)", async () => {
    await renderGrid();
    const input = await openMenu();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Title");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Title".length);
    // The accessible's name stands the translation (not the raw key).
    expect(input.getAttribute("aria-label")).toBe("Rename Title");
  });

  it("the Enter commits over one write; the field stands the typed name (no revert)", async () => {
    const { bridge, tableId, titleColId } = await renderGrid();
    const spy = vi.spyOn(bridge, "updateColumn");
    const input = await openMenu();
    fireEvent.change(input, { target: { value: "Headline X" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await settleGrid();
    // The bridge's column stands renamed (the write's settle).
    const schema = await bridge.describeTable(tableId);
    expect(schema.columns.find((column) => column.id === titleColId)?.name).toBe("Headline X");
    // The field stands the typed name (the stale reseed's removal — the
    // menu's content keeps the draft, the live name's settle stands the
    // field's value, not a revert over the old's one).
    const live = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']");
    expect(live?.value).toBe("Headline X");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the pristine field stands the bridge's rename over an open edit (the live's reseed)", async () => {
    const { bridge, tableId, titleColId } = await renderGrid();
    const input = await openMenu();
    expect(input.value).toBe("Title");
    await act(async () => {
      await bridge.updateColumn(tableId, titleColId, { name: "Peer Name" }, ctx());
    });
    await settleGrid();
    const live = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']")!;
    expect(live.value).toBe("Peer Name");
  });

  it("the typed draft stands over the bridge's rename (the input's text's keep)", async () => {
    const { bridge, tableId, titleColId } = await renderGrid();
    const input = await openMenu();
    fireEvent.change(input, { target: { value: "My Draft" } });
    await act(async () => {
      await bridge.updateColumn(tableId, titleColId, { name: "Peer Name" }, ctx());
    });
    await settleGrid();
    const live = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']")!;
    expect(live.value).toBe("My Draft");
  });

  it("the Escape cancels without a write; the reopen's seed stands the live name", async () => {
    const { bridge, tableId, titleColId } = await renderGrid();
    const spy = vi.spyOn(bridge, "updateColumn");
    const input = await openMenu();
    fireEvent.change(input, { target: { value: "Scratch" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-rename-input']") === null,
      "the menu's close"
    );
    expect(spy).not.toHaveBeenCalled();
    const schema = await bridge.describeTable(tableId);
    expect(schema.columns.find((column) => column.id === titleColId)?.name).toBe("Title");
    // The reopen's fresh seed (the settled name's stand).
    const reopened = await openMenu();
    expect(reopened.value).toBe("Title");
  });

  it("the Enter's commit + the menu's close stand one write (the committed-once's guard)", async () => {
    const { bridge } = await renderGrid();
    const spy = vi.spyOn(bridge, "updateColumn");
    const input = await openMenu();
    fireEvent.change(input, { target: { value: "Single Write" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // The menu's close over the Escape (the unmount's blur's double-fire's
    // stand — the guard's no-op).
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-rename-input']") === null,
      "the menu's close"
    );
    await settleGrid();
    const renames = spy.mock.calls.filter((call) => (call[2] as { name?: string }).name === "Single Write");
    expect(renames).toHaveLength(1);
  });

  it("the empty / the unchanged's trimmed stand the no-write", async () => {
    const { bridge, tableId, titleColId } = await renderGrid();
    const spy = vi.spyOn(bridge, "updateColumn");
    const input = await openMenu();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.blur(input);
    await settleGrid();
    expect(spy).not.toHaveBeenCalled();
    const schema = await bridge.describeTable(tableId);
    expect(schema.columns.find((column) => column.id === titleColId)?.name).toBe("Title");
  });
});
