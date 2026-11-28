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

// The table's rename's contract (the toolbar's inline edit — the
// `InlineEditInput`'s stand): the open's focus + the select-all, the commit
// over the Enter / the blur (one write — the committed-once's guard over the
// unmount's double fire), the close over the commit, and the Escape's cancel
// without a write.

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

/** Polls the condition over the settled frames. */
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

/** The grid's settle over the stream's refetch (the table event's delivery). */
async function settleGrid(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** Seeds one table (one text column + one row) and renders the grid over it. */
async function renderGrid() {
  const bridge = createMemoryDatabaseBridge();
  const table = await bridge.createTable({ name: "Board" }, ctx());
  const tableId = table.result.id;
  const column = await bridge.createColumn(
    tableId,
    { column: { name: "Task", type: "text", position: 0, nullable: true } },
    ctx()
  );
  await bridge.batchRows(
    tableId,
    { ops: [{ op: "create", row: { [column.result.id]: "a row" }, beforeRowId: null }] },
    ctx()
  );
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  doc.insertBlock("database", { tableId });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge}>
      <Editor />
    </EditorProvider>
  );
  await until(
    () => document.querySelector("[data-slot='docblocks/database-name']")?.textContent === "Board",
    "the grid's ready stand"
  );
  return { bridge, tableId };
}

/** Opens the table's name's edit (the display's press). */
async function openNameEdit(): Promise<HTMLInputElement> {
  fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-name']")!);
  await until(() => document.querySelector("[data-slot='docblocks/database-name-input']") !== null, "the name's edit");
  return document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-name-input']")!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the table's rename (the toolbar's inline edit)", () => {
  it("the open stands the field's focus + the select-all + the accessible's name", async () => {
    await renderGrid();
    const input = await openNameEdit();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Board");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Board".length);
    expect(input.getAttribute("aria-label")).toBe("Rename table Board");
  });

  it("the Enter commits over one write and closes the edit (the committed-once's guard)", async () => {
    const { bridge, tableId } = await renderGrid();
    const spy = vi.spyOn(bridge, "renameTable");
    const input = await openNameEdit();
    fireEvent.change(input, { target: { value: "My Board" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-name-input']") === null,
      "the edit's close"
    );
    await settleGrid();
    expect((await bridge.describeTable(tableId)).table.name).toBe("My Board");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("My Board");
  });

  it("the blur commits over one write (the cell's press's stand)", async () => {
    const { bridge, tableId } = await renderGrid();
    const spy = vi.spyOn(bridge, "renameTable");
    const input = await openNameEdit();
    fireEvent.change(input, { target: { value: "Blur Board" } });
    fireEvent.blur(input);
    await settleGrid();
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await bridge.describeTable(tableId)).table.name).toBe("Blur Board");
  });

  it("the Escape cancels without a write; the display's stand is unchanged", async () => {
    const { bridge, tableId } = await renderGrid();
    const spy = vi.spyOn(bridge, "renameTable");
    const input = await openNameEdit();
    fireEvent.change(input, { target: { value: "Scratch" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-name-input']") === null,
      "the edit's close"
    );
    expect(spy).not.toHaveBeenCalled();
    expect((await bridge.describeTable(tableId)).table.name).toBe("Board");
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Board");
  });
});
