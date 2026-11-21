// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { DatabaseColumn } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

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

const COLUMNS: DatabaseColumn[] = [
  { id: "name", name: "Name", type: "text" },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "status", name: "Status", type: "select", options: ["active", "done"] },
];

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

/** The row's cells over the bridge's page (the page's row order stands). */
async function cellsOf(bridge: DatabaseBridge, tableId: string, rowId: string): Promise<Record<string, unknown>> {
  const page = await bridge.snapshotTable(tableId, {});
  const row = page.page.rows.find((entry) => entry.id === rowId);
  if (row === undefined) throw new Error(`the row "${rowId}" is not in the table "${tableId}"`);
  return row.cells;
}

afterEach(() => cleanup());

describe("built-in renderer: database (the placeholder card)", () => {
  it("renders the column names and the row count", () => {
    renderDoc((doc) => {
      const db = doc.insertBlock("database", { columns: COLUMNS });
      const r1 = doc.insertRow(db);
      const r2 = doc.insertRow(db);
      doc.setCell(db, r1, "name", "first");
      doc.setCell(db, r1, "status", "active");
      doc.setCell(db, r2, "done", true);
      return db;
    });

    const wrapper = document.querySelector<HTMLElement>('[data-slot="docblocks/block"][data-block-type="database"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.getAttribute("data-block-id")).not.toBeNull();

    const card = wrapper!.querySelector("[data-slot='docblocks/database']");
    expect(card).not.toBeNull();
    const headerNames = [...wrapper!.querySelectorAll("[data-slot='docblocks/database-column']")].map(
      (column) => column.textContent
    );
    expect(headerNames).toEqual(["Name", "Done", "Status"]);
    // The select column carries its type on the header cell (the consumer hint).
    const status = wrapper!.querySelector("[data-column-type='select']");
    expect(status?.textContent).toBe("Status");
    expect(wrapper!.querySelector("[data-slot='docblocks/database-count']")?.textContent).toBe("2 rows");
  });
  it("renders the zero-rows state", () => {
    renderDoc((doc) => doc.insertBlock("database", { columns: COLUMNS }));
    const wrapper = document.querySelector<HTMLElement>('[data-block-type="database"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("[data-slot='docblocks/database-count']")?.textContent).toBe("0 rows");
  });
  it("the row count is live: a store-level command updates the card", () => {
    const { doc, db } = renderDoc((doc) => doc.insertBlock("database", { columns: COLUMNS }));

    act(() => {
      const row = doc.insertRow(db);
      doc.setCell(db, row, "name", "first");
    });
    const wrapper = document.querySelector<HTMLElement>('[data-block-type="database"]');
    expect(wrapper!.querySelector("[data-slot='docblocks/database-count']")?.textContent).toBe("1 row");
  });
  it("the wrapper contract: not text-editable, no gutter", () => {
    renderDoc((doc) => doc.insertBlock("database", { columns: COLUMNS }));
    const wrapper = document.querySelector<HTMLElement>('[data-block-type="database"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("[data-slot='docblocks/block-content']")).toBeNull();
    expect(wrapper!.querySelector("[contenteditable]")).toBeNull();
    expect(wrapper!.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
  });
  it("the external form (the tableId reference) stands the live grid over the bridge", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "External" }, ctx())).result.id;
    const title = (
      await bridge.createColumn(
        tableId,
        { column: { name: "Title", type: "text", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    const n = (
      await bridge.createColumn(tableId, { column: { name: "N", type: "integer", position: 1, nullable: true } }, ctx())
    ).result.id;
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [title]: "a", [n]: 1 }, beforeRowId: null }] },
      ctx()
    );

    renderDoc((doc) => doc.insertBlock("database", { tableId }), undefined, bridge);
    await settleGrid();

    const wrapper = document.querySelector<HTMLElement>("[data-block-type='database']");
    expect(wrapper).not.toBeNull();
    // The grid card (the ready phase) — not the inline placeholder card.
    const card = wrapper!.querySelector("[data-slot='docblocks/database']");
    expect(card).not.toBeNull();
    expect(card!.getAttribute("data-state")).not.toBe("broken");
    expect(wrapper!.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("External");
    // No inline column header (that slot belongs to the inline card).
    expect(wrapper!.querySelector("[data-slot='docblocks/database-column']")).toBeNull();
  });
  it("the inline → external transition re-renders the card live", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Migrated" }, ctx())).result.id;
    await bridge.createColumn(tableId, { column: { name: "C", type: "text", position: 0, nullable: true } }, ctx());

    const { doc, db } = renderDoc((doc) => doc.insertBlock("database", { columns: COLUMNS }), undefined, bridge);
    // The inline card stands first.
    expect(document.querySelector("[data-slot='docblocks/database-column']")).not.toBeNull();

    act(() => {
      doc.setDatabaseTable(db, tableId);
    });
    await settleGrid();

    const wrapper = document.querySelector<HTMLElement>("[data-block-type='database']");
    // The inline column header is gone; the live grid card stands.
    expect(wrapper!.querySelector("[data-slot='docblocks/database-column']")).toBeNull();
    expect(wrapper!.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Migrated");
  });
  it("the timestamp column stands the datetime cell display", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Times" }, ctx())).result.id;
    const when = (
      await bridge.createColumn(
        tableId,
        { column: { name: "When", type: "timestamptz", position: 0, nullable: true } },
        ctx()
      )
    ).result.id;
    await bridge.batchRows(
      tableId,
      { ops: [{ op: "create", row: { [when]: "2024-05-17T10:30" }, beforeRowId: null }] },
      ctx()
    );

    renderDoc((doc) => doc.insertBlock("database", { tableId }), undefined, bridge);
    await settleGrid();

    const cell = document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${when}']`);
    expect(cell).not.toBeNull();
    // The datetime cell stands the display (the compact date + time
    // label): no native <input type="datetime-local">, no trigger chrome —
    // the picker opens on the double press over the cell itself.
    expect(cell!.tagName).toBe("DIV");
    expect(cell!.querySelector("input")).toBeNull();
    expect(cell!.getAttribute("data-empty")).toBeNull();
    expect(cell!.textContent).toContain("17.05.2024 10:30");
  });
  it("a valid number edit commits to the bridge and a cleared cell commits null", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = (await bridge.createTable({ name: "Nums" }, ctx())).result.id;
    const n = (
      await bridge.createColumn(tableId, { column: { name: "N", type: "integer", position: 0, nullable: true } }, ctx())
    ).result.id;
    const rowId = (
      await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [n]: 1 }, beforeRowId: null }] }, ctx())
    ).result.rows[0]!.id;

    renderDoc((doc) => doc.insertBlock("database", { tableId }), undefined, bridge);
    await settleGrid();

    const cell = document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-column-id='${n}']`)!;
    expect(cell).not.toBeNull();
    expect(cell.tagName).toBe("DIV");
    // The display stand (the value text; no input until the edit).
    expect(cell.textContent).toBe("1");
    expect(cell.querySelector("input")).toBeNull();
    // The double press stands the edit session (the input's mount).
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
    expect((await cellsOf(bridge, tableId, rowId))[n]).toBe(7);
    // The edit session closes on the commit (the display stand stands).
    expect(cell.querySelector("[data-slot='docblocks/database-cell-input']")).toBeNull();

    // Clear the cell → the memory bridge models the NULL as an absent key.
    fireEvent.doubleClick(cell);
    await settleGrid();
    const input2 = cell.querySelector<HTMLInputElement>("[data-slot='docblocks/database-cell-input']");
    await act(async () => {
      fireEvent.change(input2!, { target: { value: "" } });
    });
    await act(async () => {
      fireEvent.blur(input2!);
    });
    const cleared = await cellsOf(bridge, tableId, rowId);
    expect(cleared[n] ?? null).toBeNull();
  });
});
