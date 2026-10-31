// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { act, useState } from "react";

import { createDoc } from "docblocks-core";
import type { DatabaseBlock, DatabaseColumn, DatabaseFilterPayload } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { BridgeColumn, DatabaseBridge } from "../src/database/bridge";
import { FilterBuilder } from "../src/database/filter-builder";
import { refEntryKey } from "../src/database/grid/use-ref-tables";
import type { RefTableDataMap } from "../src/database/grid/use-ref-tables";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";
import { useDatabaseTable } from "../src/database/use-database-table";
import { DatabaseSlashPicker } from "../src/editing/slash/DatabaseSlashPicker";
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

/** Polls the condition over the settled frames (the radix portals settle async). */
async function until(condition: () => unknown, label: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
}

/** The grid on a fresh bridge (title / n / done / status; two rows). */
async function renderGrid(attrs: Record<string, unknown> = {}) {
  const bridge = createMemoryDatabaseBridge();
  const tableId = await bridge.createTable("Demo");
  // The dict table (the enum options — the PK IS the option label).
  await bridge.createTable("Statuses");
  await bridge.insertRows("table-statuses", [{ id: "todo" }, { id: "active" }, { id: "done" }]);
  await bridge.createColumn(tableId, { id: "title", name: "Title", type: "text" });
  await bridge.createColumn(tableId, { id: "n", name: "N", type: "integer" });
  await bridge.createColumn(tableId, { id: "done", name: "Done", type: "boolean" });
  await bridge.createColumn(tableId, {
    id: "status",
    name: "Status",
    type: "text",
    refKind: "enum",
    refTableId: "table-statuses",
  });
  await bridge.insertRows(tableId, [
    { title: "a", n: 1, done: false, status: "todo" },
    { title: "b", n: 2, done: true, status: "active" },
  ]);
  const { doc, db } = renderDoc((d) => d.insertBlock("database", { tableId, ...attrs }), undefined, bridge);
  await settleGrid();
  return { doc, db, bridge, tableId };
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
    const tableId = await bridge.createTable("External");
    await bridge.createColumn(tableId, { id: "title", name: "Title", type: "text" });
    await bridge.createColumn(tableId, { id: "n", name: "N", type: "integer" });
    await bridge.insertRows(tableId, [{ title: "a", n: 1 }]);

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
    const tableId = await bridge.createTable("Migrated");
    await bridge.createColumn(tableId, { id: "c", name: "C", type: "text" });

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
    const tableId = await bridge.createTable("Times");
    await bridge.createColumn(tableId, { id: "when", name: "When", type: "timestamptz" });
    await bridge.insertRows(tableId, [{ when: "2024-05-17T10:30" }]);

    renderDoc((doc) => doc.insertBlock("database", { tableId }), undefined, bridge);
    await settleGrid();

    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='when']");
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
    const tableId = await bridge.createTable("Nums");
    await bridge.createColumn(tableId, { id: "n", name: "N", type: "integer" });
    const rowIds = await bridge.insertRows(tableId, [{ n: 1 }]);
    const rowId = rowIds[0]!;

    renderDoc((doc) => doc.insertBlock("database", { tableId }), undefined, bridge);
    await settleGrid();

    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='n']")!;
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
    let page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.n).toBe(7);
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
    page = await bridge.queryRows(tableId, {});
    expect("n" in page.rows[rowId]!).toBe(false);
  });
});

describe("the grid's header (the table's name, the column menu, the column drag)", () => {
  it("the display name stands the table's name live; the rename commits to the bridge (no doc write)", async () => {
    const { doc, db, bridge, tableId } = await renderGrid();
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Demo");

    // The click opens the rename line (the commit is the blur / the Enter).
    fireEvent.click(document.querySelector("[data-slot='docblocks/database-name']")!);
    const input = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-name-input']");
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { value: "Renamed Tasks" } });
    fireEvent.blur(input!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-name']")?.textContent === "Renamed Tasks",
      "the renamed table's name stands over the table event"
    );
    // The name is the table's attribute: the bridge stands the new name.
    expect((await bridge.describeTable(tableId)).name).toBe("Renamed Tasks");
    // The rename is a bridge operation — the block's JSON stands untouched
    // (no `name` attr write).
    expect((doc.getBlock(db) as DatabaseBlock).attrs.name).toBeUndefined();
  });

  it("a legacy block `name` attr stands no display override (the table's name stands)", async () => {
    await renderGrid({ name: "Override" });
    expect(document.querySelector("[data-slot='docblocks/database-name']")?.textContent).toBe("Demo");
  });

  it("the header cell stands the name only (the type stands in the menu, not the row)", async () => {
    await renderGrid();
    const header = document.querySelector<HTMLElement>(
      "[data-slot='docblocks/database-header-cell'][data-column-id='title']"
    );
    expect(header?.textContent).toBe("Title");
    expect(header!.querySelector("[data-slot='docblocks/database-column-type']")).toBeNull();
  });

  it("the header's press stands the menu (the rename line + the read-only type line); the rename commits to the bridge", async () => {
    const { bridge, tableId } = await renderGrid();
    const header = document.querySelector<HTMLElement>(
      "[data-slot='docblocks/database-header-cell'][data-column-id='title']"
    );
    // The Ellipsis's own press stands the menu (the header's name zone's
    // press stands nothing — the menu-open's only trigger is the Ellipsis).
    const ellipsis = header!.querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
    fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
    await until(() => document.querySelector("[data-slot='docblocks/database-rename-input']") !== null, "the menu");
    const menuInput = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-rename-input']");
    const typeLine = document.querySelector("[data-slot='docblocks/database-column-type']");
    expect(typeLine?.textContent).toBe("text");

    // The rename commits on the blur (the bridge's column stands renamed).
    fireEvent.change(menuInput!, { target: { value: "Headline" } });
    fireEvent.blur(menuInput!);
    await settleGrid();
    const schema = await bridge.describeTable(tableId);
    expect(schema.columns.find((column) => column.id === "title")?.name).toBe("Headline");
    expect(
      document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='title']")?.textContent
    ).toBe("Headline");
  });

  it("the checkbox cell stands the Checkbox component (the double press toggles, the commit goes to the bridge)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='done']");
    expect(cell).not.toBeNull();
    // The package's Checkbox (the radix root, the checked state stands),
    // not a bare input — the stand (the single press is the selection, the
    // double press is the toggle).
    const box = cell!.querySelector<HTMLElement>("[data-slot='docblocks/database-cell-checkbox']");
    expect(box).not.toBeNull();
    expect(box!.getAttribute("role")).toBe("checkbox");
    expect(box!.getAttribute("data-state")).toBe("unchecked");
    expect(box!.querySelector("input")).toBeNull();

    fireEvent.doubleClick(cell!);
    await settleGrid();
    expect(box!.getAttribute("data-state")).toBe("checked");
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.done).toBe(true);
    // The toggle back stands the uncheck (the double press again).
    fireEvent.doubleClick(cell!);
    await settleGrid();
    expect(box!.getAttribute("data-state")).toBe("unchecked");
    const page2 = await bridge.queryRows(tableId, {});
    expect(page2.rows[rowId]!.done).toBe(false);
  });

  it("the checkbox's interactive stand: over the sole selection the pointer cursor + the press toggles; the multi-selection stands none", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='done']");
    const wrap = () => cell!.querySelector<HTMLElement>("[data-slot='docblocks/database-cell-checkbox-wrap']");
    // The stand (the cell unselected): the wrapper is pointer-transparent
    // (the cursor is the default, the press is the selection).
    expect(wrap()!.className).toContain("pointer-events-none");

    // The single press selects the sole cell → the stand turns interactive
    // (the pointer cursor stands).
    fireEvent.pointerDown(cell!, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(cell!, { clientX: 10, clientY: 5 });
    await settleGrid();
    expect(cell!.getAttribute("data-selected")).toBe("true");
    expect(wrap()!.className).toContain("cursor-pointer");
    expect(wrap()!.className).not.toContain("pointer-events-none");

    // The second press (the cell stands the sole selection at the press —
    // the armed stand) over the checkbox toggles (one updateRow over the
    // bridge; the selecting press itself stood no toggle).
    fireEvent.pointerDown(wrap()!, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.click(wrap()!, { detail: 1 });
    await settleGrid();
    let page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.done).toBe(true);

    // The double press over the interactive stand stands exactly one toggle
    // (the first click's toggle arms the mark, the second click is the
    // detail guard, the dblclick stands the mark).
    fireEvent.pointerDown(wrap()!, { button: 0, detail: 2, clientX: 10, clientY: 5 });
    fireEvent.click(wrap()!, { detail: 2 });
    fireEvent.doubleClick(wrap()!);
    await settleGrid();
    page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.done).toBe(true);

    // The multi-selection (the press-drag's rectangle) stands the stand off
    // again (the elementFromPoint stub stands the region's second cell).
    const nCell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='n']");
    const original = document.elementFromPoint;
    document.elementFromPoint = () => nCell!;
    fireEvent.pointerDown(cell!, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(cell!, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(cell!, { clientX: 60, clientY: 60 });
    document.elementFromPoint = original;
    await settleGrid();
    expect(wrap()!.className).toContain("pointer-events-none");
  });

  it("the enum cell stands the package's picker (the double press opens; the pick commits; the search filters; the empty pick clears)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='status']");
    // The picker's trigger (the chip's stand over the value) — the radix
    // combobox / the native select stand out. The single press is the
    // selection, the double press opens the list.
    const trigger = () => cell()!.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-picker-trigger']");
    expect(trigger()).not.toBeNull();
    expect(cell()!.querySelector("[role='combobox']")).toBeNull();
    expect(cell()!.textContent).toContain("todo");

    const open = async () => {
      fireEvent.doubleClick(cell()!);
      await until(
        () => document.querySelector("[data-slot='docblocks/database-enum-picker-search']") !== null,
        "the picker's list"
      );
    };
    const row = (label: string) =>
      [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-picker-row']")].find(
        (entry) => entry.textContent === label
      );

    // The pick commits to the bridge (one updateRow) over the row's press.
    await open();
    fireEvent.click(row("done")!);
    await settleGrid();
    expect((await bridge.queryRows(tableId, {})).rows[rowId]!.status).toBe("done");
    expect(cell()!.textContent).toContain("done");

    // The search filters the list (the client-side stand over the loaded
    // options).
    await open();
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-enum-picker-search']")!, {
      target: { value: "do" },
    });
    await settleGrid();
    expect(row("active")).toBeUndefined();
    expect(row("done")).toBeDefined();

    // The empty option clears the cell (the null stands).
    await open();
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-picker-clear']")!);
    await settleGrid();
    const page2 = await bridge.queryRows(tableId, {});
    // The bridge drops the cleared cell (the absent value stands the null).
    expect(page2.rows[rowId]!.status ?? null).toBeNull();
  });

  it("the enum's dict extension stands in the cell's editor live (the ref table's event)", async () => {
    const { bridge } = await renderGrid();
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='status']");
    // The dict's option extension (the `insertRow` over the dict table — the
    // PK IS the option label): the cell's editor list refreshes over the
    // ref table's live event.
    await bridge.insertRow("table-statuses", { id: "review" });
    await until(() => cell() !== null, "the cell");
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-enum-picker-search']") !== null,
      "the picker's list"
    );
    await until(
      () =>
        [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-picker-row']")].some(
          (entry) => entry.textContent === "review"
        ),
      "the live option"
    );
  });

  it("the row-link cell stands the resolved display (the join over the bridge; the dead row id keeps the raw stand)", async () => {
    const { bridge, tableId } = await renderGrid();
    // The linked table + the row-link column (the display over the first
    // text column — the default stand). The linked table's columns: the
    // `code` (the non-display stand) + the `name` (the declared display
    // column — the `refDisplayColumn`'s stand over the first-text
    // default).
    await bridge.createTable("People");
    await bridge.createColumn("table-people", { id: "code", name: "Code", type: "text" });
    await bridge.createColumn("table-people", { id: "name", name: "Name", type: "text" });
    const peopleIds = await bridge.insertRows("table-people", [
      { code: "P-1", name: "Ann" },
      { code: "P-2", name: "Bob" },
    ]);
    const annId = peopleIds[0]!;
    await bridge.createColumn(tableId, {
      id: "owner",
      name: "Owner",
      type: "text",
      refKind: "row",
      refTableId: "table-people",
      refDisplayColumn: "name",
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    await bridge.updateRow(tableId, rowId, { owner: annId });
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='owner']");
    await until(() => cell() !== null, "the cell");
    await until(() => (cell()!.textContent ?? "").includes("Ann"), "the display");
    expect(cell()!.textContent).toContain("Ann");

    // The dead row id stands the raw stand (the lenient read — the display
    // resolution stands none over the unknown row).
    await bridge.updateRow(tableId, rowId, { owner: "r-table-people-99" });
    await until(() => (cell()!.textContent ?? "").includes("r-table-people-99"), "the raw stand");
  });

  it("the row-link's picker: the search filters the rows; the pick commits the row id; the clear entry clears", async () => {
    const { bridge, tableId } = await renderGrid();
    await bridge.createTable("People");
    await bridge.createColumn("table-people", { id: "name", name: "Name", type: "text" });
    const peopleIds = await bridge.insertRows("table-people", [{ name: "Ann" }, { name: "Bob" }]);
    const annId = peopleIds[0]!;
    const bobId = peopleIds[1]!;
    await bridge.createColumn(tableId, {
      id: "owner",
      name: "Owner",
      type: "text",
      refKind: "row",
      refTableId: "table-people",
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='owner']");
    await until(() => cell() !== null, "the cell");

    // The double press opens the picker (the search + the rows over the
    // resolved displays).
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='docblocks/database-row-picker']") !== null, "the picker");
    expect(
      document.querySelector<HTMLElement>(`[data-slot='docblocks/database-row-picker-row'][data-row-id='${annId}']`)
        ?.textContent
    ).toBe("Ann");
    // The search filters the list (the client-side stand over the loaded
    // page).
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-row-picker-search']")!, {
      target: { value: "bo" },
    });
    await settleGrid();
    expect(
      document.querySelector(`[data-slot='docblocks/database-row-picker-row'][data-row-id='${annId}']`)
    ).toBeNull();
    const bobRow = document.querySelector<HTMLElement>(
      `[data-slot='docblocks/database-row-picker-row'][data-row-id='${bobId}']`
    )!;
    expect(bobRow.textContent).toBe("Bob");
    fireEvent.click(bobRow);
    await settleGrid();
    const after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.owner).toBe(bobId);
    await until(() => (cell()!.textContent ?? "").includes("Bob"), "the new display");

    // The clear entry stands the null.
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='docblocks/database-row-picker']") !== null, "the picker");
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-row-picker-clear']")!);
    await settleGrid();
    const cleared = await bridge.queryRows(tableId, {});
    expect(cleared.rows[rowId]!.owner ?? null).toBeNull();
  });

  it("the multi-enum cell: the display stands the chips; the editor's toggle commits the array", async () => {
    const { bridge, tableId } = await renderGrid();
    await bridge.createColumn(tableId, {
      id: "tags",
      name: "Tags",
      type: "text",
      refKind: "enum",
      refTableId: "table-statuses",
      refMany: true,
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    await bridge.updateRow(tableId, rowId, { tags: ["todo", "done"] });
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='tags']");
    const chips = () =>
      cell() === null
        ? []
        : [...cell()!.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-ref-chip']")].map(
            (chip) => chip.textContent
          );
    await until(() => cell() !== null, "the cell");
    // The display stands the chips' train (the joined text is out).
    await until(() => chips().length === 2, "the chips");
    expect(chips()).toEqual(["todo", "done"]);

    // The double press opens the checkbox list (the toggle commits the
    // array immediately — one `updateRow` per option).
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-ref-multi-option']") !== null,
      "the multi editor"
    );
    const option = (value: string) =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`
      );
    // The checkboxes stand the committed values.
    expect(option("todo")!.getAttribute("data-state")).toBe("checked");
    expect(option("active")!.getAttribute("data-state")).not.toBe("checked");
    fireEvent.click(option("active")!);
    await settleGrid();
    const after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.tags).toEqual(["todo", "done", "active"]);
    // The chips stand the live values.
    await until(() => chips().length === 3, "the chips' update");
    expect(chips()).toEqual(["todo", "done", "active"]);
    // The uncheck drops the option (the array's stand).
    fireEvent.click(option("todo")!);
    await settleGrid();
    const after2 = await bridge.queryRows(tableId, {});
    expect(after2.rows[rowId]!.tags).toEqual(["done", "active"]);
    await until(() => chips().length === 2, "the chips' uncheck");
    expect(chips()).toEqual(["done", "active"]);
  });

  it("the multi-enum's EMPTY cell: the double press stands the multi editor; the first pick commits the array", async () => {
    const { bridge, tableId } = await renderGrid();
    await bridge.createColumn(tableId, {
      id: "tags",
      name: "Tags",
      type: "text",
      refKind: "enum",
      refTableId: "table-statuses",
      refMany: true,
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='tags']");
    const chips = () =>
      cell() === null
        ? []
        : [...cell()!.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-ref-chip']")].map(
            (chip) => chip.textContent
          );
    await until(() => cell() !== null, "the cell");
    // The empty stand (the cell's background only — no chip, no joined
    // text) + the empty stand's flag.
    expect(chips().length).toBe(0);
    expect(cell()!.getAttribute("data-empty")).toBe("true");

    // The double press over the empty cell stands the MULTI editor (the
    // single-pick's stand is out — the bug's regression pin).
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-ref-multi-option']") !== null,
      "the multi editor"
    );
    const option = (value: string) =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`
      );
    expect(option("todo")!.getAttribute("data-state")).not.toBe("checked");

    // The first pick commits the ARRAY (the scalar's stand is out —
    // `[value]`), the second pick appends (the toggle's one `updateRow`).
    fireEvent.click(option("todo")!);
    await settleGrid();
    let after = await bridge.queryRows(tableId, {});
    expect(Array.isArray(after.rows[rowId]!.tags)).toBe(true);
    expect(after.rows[rowId]!.tags).toEqual(["todo"]);
    await until(() => chips().length === 1, "the chip");
    expect(chips()).toEqual(["todo"]);
    fireEvent.click(option("done")!);
    await settleGrid();
    after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.tags).toEqual(["todo", "done"]);
    await until(() => chips().length === 2, "the chips");

    // The uncheck over the last value stands the empty array (the cell's
    // empty stand is back — the null's stand is out for the many's
    // cardinality: the commit is the array always).
    fireEvent.click(option("todo")!);
    await settleGrid();
    fireEvent.click(option("done")!);
    await settleGrid();
    after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.tags).toEqual([]);
    await until(() => chips().length === 0, "the chips' clear");
  });

  it("the multi row-links' EMPTY cell: the picks stand the array of the row ids; the chips stand the displays", async () => {
    const { bridge, tableId } = await renderGrid();
    await bridge.createTable("People");
    await bridge.createColumn("table-people", { id: "name", name: "Name", type: "text" });
    const peopleIds = await bridge.insertRows("table-people", [{ name: "Ann" }, { name: "Bob" }]);
    const annId = peopleIds[0]!;
    const bobId = peopleIds[1]!;
    await bridge.createColumn(tableId, {
      id: "owners",
      name: "Owners",
      type: "text",
      refKind: "row",
      refTableId: "table-people",
      refMany: true,
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='owners']");
    const chips = () =>
      cell() === null
        ? []
        : [...cell()!.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-ref-chip']")].map(
            (chip) => chip.textContent
          );
    await until(() => cell() !== null, "the cell");
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-ref-multi-option']") !== null,
      "the multi editor"
    );
    const option = (rowId: string) =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-ref-multi-option'][data-option-value='${rowId}']`
      );
    // The options stand the linked table's rows (the displays' labels).
    expect(option(annId)!).not.toBeNull();
    fireEvent.click(option(annId)!);
    await settleGrid();
    let after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.owners).toEqual([annId]);
    await until(() => chips().length === 1, "the chip");
    expect(chips()).toEqual(["Ann"]);
    fireEvent.click(option(bobId)!);
    await settleGrid();
    after = await bridge.queryRows(tableId, {});
    expect(after.rows[rowId]!.owners).toEqual([annId, bobId]);
    await until(() => chips().length === 2, "the chips");
    expect(chips()).toEqual(["Ann", "Bob"]);
  });

  it("the header's press-drag reorders the columns (the columnOrder attr; the live preview stands no write)", async () => {
    const { doc, db } = await renderGrid();
    const dbAttrs = () => (doc.getBlock(db) as DatabaseBlock | null)?.attrs ?? {};
    const header = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-cell'][data-column-id='title']");
    // The press + the drag past the threshold (the live preview is view state
    // — the doc stands until the release).
    fireEvent.pointerDown(header()!, { clientX: 100, clientY: 5 });
    fireEvent.pointerMove(header()!, { clientX: 160, clientY: 5 });
    expect(dbAttrs()?.columnOrder).toBeUndefined();
    fireEvent.pointerUp(header()!, { clientX: 160, clientY: 5 });
    await settleGrid();
    // The jsdom rects stand zero: every stationary midpoint stands left of
    // the pointer, so the drop position is past the last stationary column
    // (title lands last — the visible order with the dragged column at the
    // pointer's drop position).
    expect(dbAttrs()?.columnOrder).toEqual(["n", "done", "status", "title"]);

    // The grid resyncs from the attr (the header order follows it).
    const order = [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")].map(
      (cell) => cell.dataset.columnId
    );
    expect(order).toEqual(["n", "done", "status", "title"]);

    // A sub-threshold press stands the menu, not a reorder (the attr stands).
    fireEvent.pointerDown(header()!, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(header()!, { clientX: 10, clientY: 5 });
    await settleGrid();
    expect(dbAttrs()?.columnOrder).toEqual(["n", "done", "status", "title"]);
  });
});

describe("the grid's cells (the type editors)", () => {
  it("the cell's blur with the unchanged value stands no commit (no bridge call, no undo entry)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    // The bridge call is the commit's wire: an unchanged blur must not
    // reach it (no no-op refetch, no no-op undo entry).
    const updateRowSpy = vi.spyOn(bridge, "updateRow");
    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='title']")!;
    // The double press stands the edit session (the portaled 6-row
    // textarea); the outside press (the blur's stand) reverts nothing and
    // commits nothing (the draft stands the value).
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.doubleClick(cell);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-cell-multiline']") !== null,
      "the edit textarea"
    );
    fireEvent.pointerDown(document.body, { button: 0 });
    await settleGrid();
    expect(updateRowSpy).not.toHaveBeenCalled();
    // The changed value commits (the guard is equality-only).
    const textarea = () =>
      document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']");
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.doubleClick(cell);
    await until(() => textarea() !== null, "the edit textarea (the re-open)");
    await act(async () => {
      fireEvent.change(textarea()!, { target: { value: "edited" } });
    });
    fireEvent.pointerDown(document.body, { button: 0 });
    await settleGrid();
    expect(updateRowSpy).toHaveBeenCalledTimes(1);
    expect(updateRowSpy).toHaveBeenCalledWith(tableId, rowId, { title: "edited" });
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.title).toBe("edited");
  });

  it("the cell wrapper owns the single border (the display / the input stand borderless)", async () => {
    await renderGrid();
    // The cell wrapper owns the single border (the interaction unit — the
    // display / the input stand inside it, borderless).
    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='title']");
    expect(cell!.className).toContain("border-(--docblocks-table-border-color)");
    expect(cell!.className).not.toContain("border-l-");
    // The second column's wrapper carries the left border (the single
    // border between the columns).
    const secondCell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='n']");
    expect(secondCell!.className).toContain("border-l-(length:--docblocks-table-border-width)");
  });

  it("the date cell stands the calendar on the double press (the pick commits the ISO date; the same-day pick clears)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "due", name: "Due", type: "date" });
    await bridge.updateRow(tableId, rowId, { due: "2026-10-19" });
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='due']");
    // The cell stands the display (the compact date), not a native
    // <input type="date"> and no trigger chrome: the calendar opens on the
    // double press over the cell itself.
    expect(cell()!.tagName).toBe("DIV");
    expect(cell()!.querySelector("input")).toBeNull();
    expect(cell()!.textContent).toContain("19.10.2026");
    expect(cell()!.getAttribute("data-empty")).toBeNull();

    // The pick: the calendar stands in the portaled content; the day's
    // click commits the ISO date (one updateRow) and the popover closes.
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    fireEvent.click(document.querySelector("button[data-day='10/20/2026']")!);
    await settleGrid();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.due).toBe("2026-10-20");
    expect(cell()!.textContent).toContain("20.10.2026");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();

    // The same-day pick clears the cell (the day-picker's toggle; the cell
    // stands the empty state). The bridge drops the cleared value.
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar (the re-open)");
    fireEvent.click(document.querySelector("button[data-day='10/20/2026']")!);
    await settleGrid();
    const page2 = await bridge.queryRows(tableId, {});
    expect(page2.rows[rowId]!.due ?? null).toBeNull();
    expect(cell()!.getAttribute("data-empty")).toBe("true");
  });

  it("the press over the portaled picker is the picker's own (the cell's selection handler stands none)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "due", name: "Due", type: "date" });
    await bridge.updateRow(tableId, rowId, { due: "2026-10-19" });
    await settleGrid();

    const cell = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='due']")!;
    fireEvent.pointerDown(cell, { button: 0 });
    fireEvent.doubleClick(cell);
    await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    expect(cell.getAttribute("data-editing")).toBe("true");
    expect(cell.getAttribute("data-selected")).toBe("true");

    // The press over the portaled day (the picker's own interaction) stands
    // no selection reset and no session tear-down: the popover is the cell's
    // child in the React tree, so the press would reach the cell's pointer
    // handler without the portaled-content guard.
    const day = document.querySelector("button[data-day='10/20/2026']")!;
    fireEvent.pointerDown(day);
    await settleGrid();
    expect(document.querySelector("[data-slot='calendar']")).not.toBeNull();
    expect(cell.getAttribute("data-editing")).toBe("true");
    expect(cell.getAttribute("data-selected")).toBe("true");

    // The day's click still commits (the press did not tear the session down).
    fireEvent.click(day);
    await settleGrid();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.due).toBe("2026-10-20");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
  });

  it("the grid's horizontal scroller stands the ScrollArea (the thin-scrollbar contract)", async () => {
    await renderGrid();
    const grid = document.querySelector<HTMLElement>("[data-slot='docblocks/database-grid']");
    expect(grid).not.toBeNull();
    // The scroll container is the ScrollArea primitive (the thin native
    // scrollbar styled to the theme's border color), not a bare overflow div.
    expect(grid!.className).toContain("scrollbar-thin");
    expect(grid!.className).toContain("scrollbar-color:var(--border)_transparent");
    expect(grid!.className).toContain("overflow-auto");
  });

  it("the header's right-edge seam resizes the column (the columnWidths attr; the no-op drag stands none)", async () => {
    const { doc, db } = await renderGrid();
    const dbAttrs = () => (doc.getBlock(db) as DatabaseBlock | null)?.attrs ?? {};
    const seam = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-col-resize'][data-index='0']");
    expect(seam()).not.toBeNull();

    // The drag past the threshold: the live preview is view state (the doc
    // stands until the release), the release commits the widths (one
    // updateBlock). The jsdom rects stand zero: the start width is the
    // default, the delta stands the new width, the untouched columns stand
    // the default.
    fireEvent.pointerDown(seam()!, { clientX: 100, clientY: 5 });
    fireEvent.pointerMove(seam()!, { clientX: 160, clientY: 5 });
    expect(dbAttrs().columnWidths).toBeUndefined();
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    expect(table!.style.gridTemplateColumns).toContain("172px");
    fireEvent.pointerUp(seam()!, { clientX: 160, clientY: 5 });
    await settleGrid();
    expect(dbAttrs().columnWidths).toEqual([172, 112, 112, 112]);
    expect(table!.style.gridTemplateColumns).toContain("172px");

    // A 0 px drag stands a no-op (the attr stands no write).
    fireEvent.pointerDown(document.querySelector("[data-slot='docblocks/database-col-resize'][data-index='1']")!, {
      clientX: 200,
      clientY: 5,
    });
    fireEvent.pointerMove(document.querySelector("[data-slot='docblocks/database-col-resize'][data-index='1']")!, {
      clientX: 200,
      clientY: 5,
    });
    fireEvent.pointerUp(document.querySelector("[data-slot='docblocks/database-col-resize'][data-index='1']")!, {
      clientX: 200,
      clientY: 5,
    });
    await settleGrid();
    expect(dbAttrs().columnWidths).toEqual([172, 112, 112, 112]);
  });

  it("the datetime cell stands the calendar + the time on the double press (the close commits the ISO date-time)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "at", name: "At", type: "timestamptz" });
    await bridge.updateRow(tableId, rowId, { at: "2026-10-01T18:00" });
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='at']");
    // The cell stands the display (the compact date + time), not a native
    // <input type="datetime-local"> and no trigger chrome: the calendar +
    // the time box open on the double press over the cell itself.
    expect(cell()!.tagName).toBe("DIV");
    expect(cell()!.textContent).toContain("01.10.2026 18:00");

    // The pick + the time: the calendar stands in the portal, the day click
    // + the minutes stand the draft, the Escape commits the ISO string.
    fireEvent.doubleClick(cell()!);
    await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    const [, minutes] = [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.keyDown(document.querySelector("[data-slot='popover-content']")!, { key: "Escape", bubbles: true });
    await settleGrid();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.at).toBe("2026-10-05T18:30");
    expect(cell()!.textContent).toContain("05.10.2026 18:30");
  });
});

describe("the datetime cell's draft contract (the time/date order, the same-day toggle, the mid-session value)", () => {
  // The timestamptz column + the seed value (the draft stands from it at
  // the double-press's open).
  async function renderDateTime() {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "at", name: "At", type: "timestamptz" });
    await bridge.updateRow(tableId, rowId, { at: "2026-10-01T18:00" });
    await settleGrid();
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='at']")!;
    const value = async () => (await bridge.queryRows(tableId, {})).rows[rowId]!.at ?? null;
    const segments = () => [...document.querySelectorAll<HTMLInputElement>("[data-slot='time-segments'] input")];
    const openPicker = async () => {
      // The real gesture's stand: the press (the grid's session + the
      // selection stand — the document's outside-press handler stands over
      // the selection) + the double press (the picker's open).
      fireEvent.pointerDown(cell(), { button: 0 });
      fireEvent.doubleClick(cell());
      await until(() => document.querySelector("[data-slot='calendar']") !== null, "the calendar");
    };
    const closeByEscape = async () => {
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
      cell,
      value,
      segments,
      openPicker,
      closeByEscape,
      closeByTriggerPress,
      closeByOutsidePress,
    };
  }

  it("the time first + the date after commit both (the reverse order; the Escape close)", async () => {
    const { value, segments, openPicker, closeByEscape, cell } = await renderDateTime();
    await openPicker();
    // The time stands first (the hours + the minutes), the day's pick after:
    // the in-flight draft's time stands the day's click (no reset).
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    await closeByEscape();
    expect(await value()).toBe("2026-10-05T09:30");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
    expect(cell().textContent).toContain("05.10.2026 09:30");
  });

  it("the time first + the date after commit both (the trigger-press close)", async () => {
    const { value, segments, openPicker, closeByTriggerPress } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "11" } });
    fireEvent.change(minutes!, { target: { value: "15" } });
    fireEvent.click(document.querySelector("button[data-day='10/7/2026']")!);
    await closeByTriggerPress();
    expect(await value()).toBe("2026-10-07T11:15");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
  });

  it("the time → the date → the time: the last stand commits", async () => {
    const { value, segments, openPicker, closeByEscape } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    // The time's re-edit over the day's pick stands (the draft's time is not
    // re-read from the value on the day's click).
    fireEvent.change(hours!, { target: { value: "14" } });
    await closeByEscape();
    expect(await value()).toBe("2026-10-05T14:30");
  });

  it("the same-day re-pick resets no draft date (the typed time commits over the date)", async () => {
    const { value, segments, openPicker, closeByEscape } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "07" } });
    fireEvent.change(minutes!, { target: { value: "45" } });
    // The value's date stands selected (the draft's day): the re-pick is the
    // day-picker's toggle (the undefined stand) — the draft date stands.
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    await closeByEscape();
    expect(await value()).toBe("2026-10-01T07:45");
  });

  it("the same-day re-pick over the untouched draft stands no commit", async () => {
    const { value, openPicker, closeByEscape } = await renderDateTime();
    await openPicker();
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    await closeByEscape();
    expect(await value()).toBe("2026-10-01T18:00");
  });

  it("the outside press commits the in-flight draft (the teardown stand; the reverse order)", async () => {
    const { value, segments, openPicker, closeByOutsidePress, cell } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "07" } });
    fireEvent.change(minutes!, { target: { value: "45" } });
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    // The press outside the grid (the grid's session clear stands no radix
    // close callback — the popover unmounts before its deferred dispatch):
    // the cell's teardown stand commits the draft.
    await closeByOutsidePress();
    expect(await value()).toBe("2026-10-05T07:45");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
    expect(cell().textContent).toContain("05.10.2026 07:45");
  });

  it("the other cell's press commits the in-flight draft (the teardown stand)", async () => {
    const { value, segments, openPicker, cell } = await renderDateTime();
    await openPicker();
    const [hours] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.click(document.querySelector("button[data-day='10/6/2026']")!);
    // The press over the second row's cell (the grid's session clear stands
    // no radix close): the teardown stand commits the draft + the press
    // selects the other cell.
    const otherCell = document.querySelector<HTMLElement>(
      "[data-slot='docblocks/database-cell'][data-column-id='at'][data-row='1']"
    )!;
    fireEvent.pointerDown(otherCell, { button: 0 });
    await settleGrid();
    expect(await value()).toBe("2026-10-06T09:00");
    expect(otherCell.getAttribute("data-selected")).toBe("true");
    expect(cell().getAttribute("data-editing")).toBeNull();
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
  });

  it("the outside press over the untouched draft stands no commit (the no-op stand)", async () => {
    const { value, openPicker, closeByOutsidePress } = await renderDateTime();
    await openPicker();
    await closeByOutsidePress();
    expect(await value()).toBe("2026-10-01T18:00");
    expect(document.querySelector("[data-slot='calendar']")).toBeNull();
  });

  it("the repeat-commit guard stands per session (a later session re-commits the earlier ISO)", async () => {
    const { bridge, tableId, rowId, value, segments, openPicker, closeByEscape } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    await closeByEscape();
    expect(await value()).toBe("2026-10-01T09:30");
    // The peer's write moves the value away; the later session explicitly
    // restores the earlier ISO (the day's pick + the time) — the guard's
    // per-session stand (the open resets it) commits the restore.
    await bridge.updateRow(tableId, rowId, { at: "2026-10-02T00:00" });
    await until(async () => (await value()) === "2026-10-02T00:00", "the peer's value");
    await openPicker();
    const [hours2, minutes2] = segments();
    fireEvent.change(hours2!, { target: { value: "09" } });
    fireEvent.change(minutes2!, { target: { value: "30" } });
    fireEvent.click(document.querySelector("button[data-day='10/1/2026']")!);
    await closeByEscape();
    expect(await value()).toBe("2026-10-01T09:30");
  });

  it("the mid-session value change stands the draft (the in-flight edit wins the commit)", async () => {
    const { bridge, tableId, rowId, cell, value, segments, openPicker, closeByEscape } = await renderDateTime();
    await openPicker();
    const [hours, minutes] = segments();
    fireEvent.change(hours!, { target: { value: "09" } });
    fireEvent.change(minutes!, { target: { value: "30" } });
    // The peer's write over the same cell (the bridge event's refetch)
    // re-renders the value — the in-flight draft stands (no reset).
    await bridge.updateRow(tableId, rowId, { at: "2026-11-11T08:00" });
    await until(() => cell().textContent === "11.11.2026 08:00", "the peer's value stand");
    // The draft's date stand: the day's pick over the still-open calendar.
    fireEvent.click(document.querySelector("button[data-day='10/5/2026']")!);
    await closeByEscape();
    expect(await value()).toBe("2026-10-05T09:30");
  });
});

describe("the cell interaction (the selection, the edit, the multi-select clear)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  it("the single press selects the cell (the stand); the edit stands on the double press", async () => {
    await renderGrid();
    const titleCell = cellOf(0, 0);
    // The single press (the pointer session) stands the selection stand.
    fireEvent.pointerDown(titleCell!, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(titleCell!, { clientX: 10, clientY: 5 });
    await settleGrid();
    expect(titleCell!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 1)!.getAttribute("data-selected")).toBeNull();
    // The selection's stand: the canvas figure's outline token (the thin
    // cyan outline over the selection tint), the inset offset (the
    // negative — the four sides stand over the edge cells, the outset
    // frame would stand clipped by the scroller).
    expect(titleCell!.className).toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(titleCell!.className).toContain("outline-(length:--docblocks-canvas-selection-border-width)");
    expect(titleCell!.className).toContain("outline-offset-[-1px]");
    expect(cellOf(0, 1)!.className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
    // The edit stands on the double press (the portaled 6-row textarea's
    // mount), not the single one.
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).toBeNull();
    fireEvent.doubleClick(titleCell!);
    await settleGrid();
    expect(titleCell!.getAttribute("data-editing")).toBe("true");
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']");
    expect(textarea).not.toBeNull();
    expect(textarea!.rows).toBe(6);
    // The grid's pointer model stands the selection — the native text
    // selection over the drag is suppressed (the table's select-none; the
    // portaled textarea stands its own native text selection).
    expect(document.querySelector("[data-slot='docblocks/database-table']")!.className).toContain("select-none");
    // The header's background stands slightly over the rows' (the muted
    // token over the transparent row stand — the row's header distinction).
    expect(document.querySelector("[data-slot='docblocks/database-header-cell']")!.className).toContain("bg-muted/40");
    expect(titleCell!.className).not.toContain("bg-muted/40");
  });

  it("the empty cells stand empty (no placeholder, no trigger chrome)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[1]!;
    // The second row's status is the value; clear the title + n of it → the
    // cells stand empty (the display stand, no chrome).
    await bridge.updateRow(tableId, rowId, { title: null, n: null });
    await settleGrid();
    const empty = cellOf(1, 0);
    expect(empty).not.toBeNull();
    expect(empty!.getAttribute("data-empty")).toBe("true");
    expect(empty!.textContent).toBe("");
    expect(empty!.querySelector("input")).toBeNull();
  });

  it("the press-drag stands the rectangular region; the Delete stands the clear (one updateRow per row; the boolean uncheck)", async () => {
    const { bridge, tableId } = await renderGrid();
    // The drag from the (0,0) to the (1,2): the jsdom elementFromPoint
    // stands the target cell stub (the region is the 2x3).
    const a = cellOf(0, 0)!;
    const b = cellOf(1, 2)!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => b;
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(a, { clientX: 60, clientY: 60 });
    await settleGrid();
    // The live region stands the selection (the 2x3 rectangle), the doc
    // stands until the Delete.
    expect(cellOf(0, 0)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 1)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(0, 2)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 0)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 1)!.getAttribute("data-selected")).toBe("true");
    expect(cellOf(1, 2)!.getAttribute("data-selected")).toBe("true");
    // The multi-selection's stand: the fill (the canvas selection's fill —
    // the border token at 50%), no outline (the outline stands the sole
    // selection — the region stands no frame on any cell).
    expect(cellOf(0, 0)!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(cellOf(0, 0)!.className).not.toContain("outline-(--docblocks-canvas-selection-border-color)");
    expect(cellOf(1, 1)!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    expect(cellOf(1, 1)!.className).not.toContain("outline-offset-1");
    document.elementFromPoint = original;
    fireEvent.pointerUp(a, { clientX: 60, clientY: 60 });
    await settleGrid();

    // The Delete over the stand: one updateRow per row (the columns are
    // the null cells; the boolean null stands the unchecked box).
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "Delete", bubbles: true });
    await settleGrid();
    const page = await bridge.queryRows(tableId, {});
    const [rowA, rowB] = Object.values(page.rows);
    expect(rowA?.title ?? null).toBeNull();
    expect(rowA?.n ?? null).toBeNull();
    expect(rowA?.done ?? null).toBeNull();
    expect(rowB?.title ?? null).toBeNull();
    expect(rowB?.n ?? null).toBeNull();
    expect(rowB?.done ?? null).toBeNull();
    // The selection stands after the clear (the stand is the view state).
    expect(cellOf(0, 0)!.getAttribute("data-selected")).toBe("true");
  });

  it("the region clear stands ONE commit: the grid's Undo stands every cleared row back over the single press", async () => {
    const { bridge, tableId } = await renderGrid();
    const a = cellOf(0, 0)!;
    const b = cellOf(1, 1)!;
    const original = document.elementFromPoint;
    document.elementFromPoint = () => b;
    fireEvent.pointerDown(a, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerMove(a, { clientX: 60, clientY: 60 });
    fireEvent.pointerUp(a, { clientX: 60, clientY: 60 });
    document.elementFromPoint = original;
    await settleGrid();
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "Delete", bubbles: true });
    await settleGrid();
    let page = await bridge.queryRows(tableId, {});
    for (const row of Object.values(page.rows)) {
      expect(row.title ?? null).toBeNull();
      expect(row.n ?? null).toBeNull();
    }
    // The ONE commit: the grid's Undo stands the WHOLE clear back (both
    // rows) over the single press — not one row per press.
    const undo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-undo']");
    expect(undo).not.toBeNull();
    expect(undo!.hasAttribute("disabled")).toBe(false);
    fireEvent.click(undo!);
    await settleGrid();
    page = await bridge.queryRows(tableId, {});
    const restored = Object.values(page.rows);
    expect(restored[0]!.title).toBe("a");
    expect(restored[0]!.n).toBe(1);
    expect(restored[1]!.title).toBe("b");
    expect(restored[1]!.n).toBe(2);
    // The redo stands the clear again over the single press.
    const redo = document.querySelector<HTMLElement>("[data-slot='docblocks/database-redo']");
    fireEvent.click(redo!);
    await settleGrid();
    page = await bridge.queryRows(tableId, {});
    for (const row of Object.values(page.rows)) expect(row.title ?? null).toBeNull();
  });

  it("the focused input keeps its own character editing (the cell clear stands no stand)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rows = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(rows.rows)[0]!;
    const cell = cellOf(0, 0)!;
    fireEvent.doubleClick(cell);
    await settleGrid();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']")!;
    // The Delete inside the textarea stands the character editing (the
    // cell clear is skipped — the portaled textarea is outside the
    // table's keys' stand).
    fireEvent.keyDown(textarea, { key: "Delete", bubbles: true });
    await settleGrid();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.title).toBe("a");
  });

  it("the Escape cancels the edit session (the draft reverts, no write over the wire)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rows = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(rows.rows)[0]!;
    const cell = cellOf(0, 0)!;
    fireEvent.doubleClick(cell);
    await settleGrid();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']");
    await act(async () => {
      fireEvent.change(textarea!, { target: { value: "drafted" } });
    });
    fireEvent.keyDown(textarea!, { key: "Escape", bubbles: true });
    await settleGrid();
    // The draft reverts to the value (the display stand), the edit session
    // closes, and the bridge stands the original value (no commit).
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).toBeNull();
    expect(cell.textContent).toBe("a");
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.title).toBe("a");
  });

  it("the Escape stands the selection no stand (and the editor's blocks gesture does not double-fire)", async () => {
    await renderGrid();
    const cell = cellOf(0, 0)!;
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    fireEvent.pointerUp(cell, { clientX: 10, clientY: 5 });
    await settleGrid();
    expect(cell.getAttribute("data-selected")).toBe("true");
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']");
    table!.focus();
    fireEvent.keyDown(table!, { key: "Escape", bubbles: true });
    await settleGrid();
    expect(cell.getAttribute("data-selected")).toBeNull();
    // The block stands (the grid's keys own the stand, not the row's
    // blocks-selection Delete).
    expect(document.querySelector("[data-slot='docblocks/database-grid']")).not.toBeNull();
  });
});

describe("the cell edit's external teardown (the mouse-blur's commit)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  /** The press's selection stand (the document-level teardown listener stands over it). */
  const pressSelect = async (cell: HTMLElement) => {
    fireEvent.pointerDown(cell, { button: 0, clientX: 10, clientY: 5 });
    await settleGrid();
  };

  it("the typed draft commits on the outside press (the input unmounts before the DOM's blur)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const titleCell = cellOf(0, 0)!;
    await pressSelect(titleCell);
    fireEvent.doubleClick(titleCell);
    await settleGrid();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "typed draft" } });
    });
    // The outside press (over the body — outside the grid): the grid's
    // session clear stands before the textarea's blur (the textarea
    // unmounts with the session) — the draft stands committed (the
    // teardown's stand, not the blur's).
    fireEvent.pointerDown(document.body, { button: 0, clientX: 5, clientY: 5 });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).toBeNull();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.title).toBe("typed draft");
  });

  it("the typed number draft commits on the other cell's press (the session's swap)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const numberCell = cellOf(0, 1)!;
    const otherCell = cellOf(1, 1)!;
    await pressSelect(numberCell);
    fireEvent.doubleClick(numberCell);
    await settleGrid();
    const input = numberCell.querySelector<HTMLInputElement>("[data-slot='docblocks/database-cell-input']")!;
    await act(async () => {
      fireEvent.change(input, { target: { value: "42" } });
    });
    // The other cell's press tears the session down (the swap) — the draft
    // stands committed as a number.
    fireEvent.pointerDown(otherCell, { button: 0, clientX: 10, clientY: 5 });
    await settleGrid();
    expect(numberCell.querySelector("[data-slot='docblocks/database-cell-input']")).toBeNull();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.n).toBe(42);
  });

  it("the Escape cancels the draft (the session closes, no write)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    const titleCell = cellOf(0, 0)!;
    await pressSelect(titleCell);
    fireEvent.doubleClick(titleCell);
    await settleGrid();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "the escaped draft" } });
    });
    fireEvent.keyDown(textarea, { key: "Escape" });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).toBeNull();
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.title).toBe("a");
  });

  it("the unchanged draft stands no commit (the no-op teardown's no undo entry)", async () => {
    await renderGrid();
    const titleCell = cellOf(0, 0)!;
    await pressSelect(titleCell);
    fireEvent.doubleClick(titleCell);
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-cell-multiline']")).not.toBeNull();
    // The outside press over the untouched draft: the no-write stand (the
    // undo's disabled stand).
    fireEvent.pointerDown(document.body, { button: 0, clientX: 5, clientY: 5 });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-undo']")?.getAttribute("data-disabled")).toBe("true");
    // The changed draft stands the undo entry (the commit's stand).
    await pressSelect(titleCell);
    fireEvent.doubleClick(titleCell);
    await settleGrid();
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-slot='docblocks/database-cell-multiline']")!;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "changed" } });
    });
    fireEvent.pointerDown(document.body, { button: 0, clientX: 5, clientY: 5 });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-undo']")?.getAttribute("data-disabled")).toBe(null);
  });
});

describe("the keyboard's selection (the arrows' slide + the shift+arrow's extension)", () => {
  const cellOf = (row: number, col: number) =>
    document.querySelector<HTMLElement>(`[data-slot='docblocks/database-cell'][data-row='${row}'][data-col='${col}']`);

  it("stands the single cell's move over the data cells (the grid's edge stands no move); the shift+arrow stands the region's extension over the anchor (the region's slide stands the shape)", async () => {
    await renderGrid(); // 4 columns x 2 rows
    const grid = document.querySelector<HTMLElement>("[data-slot='docblocks/database-grid']")!;
    const table = document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']")!;
    const selected = () =>
      Array.from(grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-cell'][data-selected='true']")).map(
        (el) => [Number(el.dataset.row), Number(el.dataset.col)]
      );
    const press = async (r: number, col: number) => {
      await act(async () => {
        fireEvent.pointerDown(cellOf(r, col)!, { button: 0, clientX: 10, clientY: 5 });
        fireEvent.pointerUp(cellOf(r, col)!, { clientX: 10, clientY: 5 });
      });
      await settleGrid();
    };
    const arrow = async (key: string, shift = false) => {
      await act(async () => {
        table.focus();
        fireEvent.keyDown(table, { key, shiftKey: shift, bubbles: true });
      });
      await settleGrid();
    };

    await press(0, 0);
    expect(selected()).toEqual([[0, 0]]);
    // The single cell's move: the arrow stands the next data cell.
    await arrow("ArrowRight");
    expect(selected()).toEqual([[0, 1]]);
    await arrow("ArrowDown");
    expect(selected()).toEqual([[1, 1]]);
    await arrow("ArrowLeft");
    expect(selected()).toEqual([[1, 0]]);
    // The grid's edge stands no move (the boundary stands the selection).
    await arrow("ArrowLeft");
    expect(selected()).toEqual([[1, 0]]);
    await arrow("ArrowUp");
    expect(selected()).toEqual([[0, 0]]);
    await arrow("ArrowUp");
    expect(selected()).toEqual([[0, 0]]);

    // The shift+arrow's region (the anchor stands, the cursor moves): the
    // 2x2 over the fill stand (no outline over the region's cells).
    await arrow("ArrowRight", true);
    expect(selected()).toEqual([
      [0, 0],
      [0, 1],
    ]);
    await arrow("ArrowDown", true);
    expect(selected()).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    const regionCell = cellOf(1, 1)!;
    expect(regionCell.classList.contains("bg-(--docblocks-canvas-selection-fill)")).toBe(true);
    expect(regionCell.classList.contains("outline-offset-[-1px]")).toBe(false);
    // The region's shrink: the cursor's move back over the anchor.
    await arrow("ArrowLeft", true);
    expect(selected()).toEqual([
      [0, 0],
      [1, 0],
    ]);
    // The region's slide (the shape stands): the column-0 pair slides
    // over the right.
    await arrow("ArrowRight");
    expect(selected()).toEqual([
      [0, 1],
      [1, 1],
    ]);
    // The region's slide stands the grid's edge clamp (no over-the-edge).
    await arrow("ArrowRight");
    await arrow("ArrowRight");
    await arrow("ArrowRight");
    expect(selected()).toEqual([
      [0, 3],
      [1, 3],
    ]);
    // The Escape stands the selection's clear (the grid's own gesture).
    await act(async () => {
      table.focus();
      fireEvent.keyDown(table, { key: "Escape", bubbles: true });
    });
    await settleGrid();
    expect(selected()).toEqual([]);
  });
});

describe("the number column (the display format + the create form)", () => {
  it("the cell's display stands the column's format (the prefix / the thousands / the suffix; the raw number stays the data)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, {
      id: "num",
      name: "Num",
      type: "number",
      decimals: 0,
      thousands: true,
      prefix: "AAA",
      suffix: "BBB",
      allowNegative: true,
    });
    await bridge.updateRow(tableId, rowId, { num: 555222 });
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='num']");
    expect(cell()!.textContent).toBe("AAA 555 222 BBB");
    // The row's data keeps the raw number (the format is the display stand
    // only — the consumer's data is never rewritten).
    const page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.num).toBe(555222);
  });

  it("the decimals stand the fixed digit count after the point (the absent stand is the integer)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "frac", name: "Frac", type: "number", decimals: 2 });
    await bridge.updateRow(tableId, rowId, { frac: 5 });
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='frac']");
    expect(cell()!.textContent).toBe("5.00");
  });

  it("the negative's reject (the allowNegative is false): the commit reverts, the valid stand commits", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "pos", name: "Pos", type: "number", allowNegative: false });
    await settleGrid();

    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='pos']");
    // The double press enters the edit (the input stands min=0).
    fireEvent.pointerDown(cell()!, { button: 0 });
    fireEvent.doubleClick(cell()!);
    const input = () => cell()!.querySelector<HTMLInputElement>("input[type='number']");
    expect(input()).not.toBeNull();
    expect(input()!.getAttribute("min")).toBe("0");

    // The negative's commit reverts (no write over the bridge).
    fireEvent.change(input()!, { target: { value: "-5" } });
    fireEvent.blur(input()!);
    await settleGrid();
    let page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.pos ?? null).toBe(null);

    // The valid stand commits.
    fireEvent.pointerDown(cell()!, { button: 0 });
    fireEvent.doubleClick(cell()!);
    fireEvent.change(input()!, { target: { value: "7" } });
    fireEvent.blur(input()!);
    await settleGrid();
    page = await bridge.queryRows(tableId, {});
    expect(page.rows[rowId]!.pos).toBe(7);
  });

  it("the float column without the explicit digits stands the raw value (no rounding; the integer stand rounds)", async () => {
    const { bridge, tableId } = await renderGrid();
    const rowId = Object.keys((await bridge.queryRows(tableId, {})).rows)[0]!;
    await bridge.createColumn(tableId, { id: "price", name: "Price", type: "double precision" });
    await bridge.createColumn(tableId, { id: "units", name: "Units", type: "integer" });
    await bridge.updateRow(tableId, rowId, { price: 1000.5, units: 1000 });
    await settleGrid();

    // The float stand keeps the value's own stand (the 0.5 is not rounded
    // away), the integer stand stands the integer digits.
    const price = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='price']");
    const units = document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='units']");
    expect(price!.textContent).toBe("1000.5");
    expect(units!.textContent).toBe("1000");
  });

  it("stands the 10-type catalog (the plain types + the relation declarations)", async () => {
    await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='text']") !== null, "the add-column menu");
    const entries = [
      "text",
      "integer",
      "decimal",
      "checkbox",
      "date",
      "datetime",
      "enum",
      "multi-enum",
      "row-link",
      "row-links",
    ];
    for (const entry of entries) {
      expect(document.querySelector(`[data-column-entry='${entry}']`)).not.toBeNull();
    }
    expect(document.querySelectorAll("[data-column-entry]").length).toBe(entries.length);
  });

  it("the ref entry stands the ref form (the table's pick; the unpicked ref disables the create)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='row-link']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='row-link']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    // The ref form's stands: the name input + the ref table's pick (the
    // catalog's tables — the Demo + the Statuses dict table). The pick is
    // the package's Select (the Radix combobox — the native select is gone
    // over the form's fields).
    const refTrigger = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/database-add-column-ref']")!;
    expect(refTrigger.tagName).toBe("BUTTON");
    expect(refTrigger.textContent).toContain("— Select a table —");
    const create = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/database-add-column-create']")!;
    expect(create.disabled).toBe(true);
    // The pick of the existing table stands the enabled create (the
    // keyboard gesture — the radix a11y path; the jsdom pointer events
    // stand no pointerType, the real mouse pick is pinned in the e2e).
    fireEvent.click(refTrigger);
    await until(() => document.querySelector("[role='listbox']") !== null, "the table's list");
    const listbox = document.querySelector<HTMLElement>("[role='listbox']")!;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.keyDown(listbox, { key: "s", bubbles: true });
    await until(
      () => document.querySelector("[role='option'][data-highlighted]")?.textContent === "Statuses",
      "the Statuses highlight"
    );
    fireEvent.keyDown(document.querySelector("[role='option'][data-highlighted]")!, { key: "Enter", bubbles: true });
    await settleGrid();
    expect(refTrigger.textContent).toBe("Statuses");
    expect(create.disabled).toBe(false);
    fireEvent.click(create);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column's create"
    );

    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created).toEqual({
      id: "col5",
      name: "Row link",
      type: "text",
      refKind: "row",
      refTableId: "table-statuses",
    });
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).toBeNull();
  });

  it("the ref form's new-table creation commits the table + the column over the create", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']");
    if (trigger === null) return;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='row-link']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='row-link']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    // The "new table" entry (the package's Select's option — the keyboard
    // gesture, the jsdom pointer's stand) stands the name's input (the
    // createTable's commit over the form's button). The enum's entry is
    // out of the flow (the options' editor stands the ref table's pick).
    const refTrigger = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/database-add-column-ref']")!;
    fireEvent.click(refTrigger);
    await until(() => document.querySelector("[role='listbox']") !== null, "the table's list");
    const listbox = document.querySelector<HTMLElement>("[role='listbox']")!;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    fireEvent.keyDown(listbox, { key: "n", bubbles: true });
    await until(
      () => document.querySelector("[role='option'][data-highlighted]")?.textContent === "New table…",
      "the new-table highlight"
    );
    fireEvent.keyDown(document.querySelector("[role='option'][data-highlighted]")!, { key: "Enter", bubbles: true });
    await settleGrid();
    const newTableInput = document.querySelector<HTMLInputElement>(
      "[data-slot='docblocks/database-add-column-ref-new']"
    )!;
    fireEvent.change(newTableInput, { target: { value: "Tags" } });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column's create"
    );

    const tables = await bridge.listTables();
    expect(tables.map((table) => table.name)).toContain("Tags");
    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created).toEqual({
      id: "col5",
      name: "Row link",
      type: "text",
      refKind: "row",
      refTableId: "table-tags",
    });
  });

  it("the column's create: the menu's Decimal entry stands the attribute form; the Add commits the column's data", async () => {
    const { bridge, tableId } = await renderGrid();
    // The plus's menu (the pointer press opens the Radix menu in jsdom):
    // the Decimal entry stands the form (the name input + the attributes
    // — the decimals field stands for the decimal, not the integer).
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='decimal']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='decimal']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null,
      "the number's form"
    );

    // The form's stands: the name input (the type's label prefill) + the
    // decimals, the thousands' separator, the prefix / the suffix, the
    // negative's reject.
    expect(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")?.value).toBe(
      "Decimal"
    );
    expect(
      document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-decimals']")?.value
    ).toBe("2");
    fireEvent.change(
      document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-decimals']")!,
      { target: { value: "1" } }
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-thousands']")!);
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-prefix']")!, {
      target: { value: "AAA" },
    });
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-suffix']")!, {
      target: { value: "BBB" },
    });
    // The negative's reject is on by default (the form's stand) — it stays.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column's create"
    );

    // The commit stands the column's data (the attributes ride the bridge's
    // column — not the block's view attr).
    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created).toEqual({
      id: "col5",
      name: "Decimal",
      type: "numeric",
      decimals: 1,
      thousands: true,
      prefix: "AAA",
      suffix: "BBB",
      allowNegative: true,
    });
    // The header stands the created column (the live schema over the bridge).
    expect(
      document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']")?.textContent
    ).toBe("Decimal");
    // The form closes on the create.
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).toBeNull();
  });

  it("the Integer entry stands the form without the decimals field (the integer's stand)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='integer']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='integer']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    // The decimals field stands none (the integer's stand), the other
    // number's attributes keep.
    expect(document.querySelector("[data-slot='docblocks/database-add-column-decimals']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-thousands']")).not.toBeNull();
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column's create"
    );

    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created).toEqual({
      id: "col5",
      name: "Integer",
      type: "integer",
      thousands: false,
      allowNegative: true,
    });
  });

  it("the menu's entry stands the create form (the name over the create; the type's attributes stand none)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='text']") !== null, "the add-column menu");
    // The Text entry stands the form (not the immediate create): the name
    // input prefills the type's label, the number's attribute fields stand
    // none (the type-specific block stands for the number / the ref).
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='text']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    const name = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!;
    expect(name.value).toBe("Text");
    expect(document.querySelector("[data-slot='docblocks/database-add-column-decimals']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-ref']")).toBeNull();
    // The name from the input stands the column's name over the create.
    fireEvent.change(name, { target: { value: "Notes" } });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column's create"
    );

    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created).toEqual({ id: "col5", name: "Notes", type: "text" });
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).toBeNull();
  });

  it("the empty name stands the disabled create (the commit is impossible over it)", async () => {
    await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='text']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='text']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    const name = document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!;
    fireEvent.change(name, { target: { value: "" } });
    const create = document.querySelector<HTMLButtonElement>("[data-slot='docblocks/database-add-column-create']")!;
    expect(create.disabled).toBe(true);
    // The press over the disabled button stands no create (the form stands).
    fireEvent.click(create);
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).not.toBeNull();
  });

  it("the Escape over the form closes without the create", async () => {
    await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='date']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='date']")!);
    const form = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-form']");
    await until(() => form !== null, "the form");
    // The Escape stands the close (the outside press stands it too) — no
    // create on either (the commit stands the form's button only).
    fireEvent.keyDown(form!, { key: "Escape", bubbles: true });
    await settleGrid();
    expect(document.querySelector("[data-slot='docblocks/database-add-column-form']")).toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']")).toBeNull();
  });
});

describe("renderer registry: database", () => {
  it("a consumer renderer for database replaces the built-in", () => {
    renderDoc((doc) => doc.insertBlock("database", { columns: COLUMNS }), {
      database: ({ id, block }) => (
        <div
          data-testid="custom-database"
          data-custom-id={id}
          data-custom-rows={block.type === "database" ? block.rowOrder.length : -1}
        />
      ),
    });

    const custom = document.querySelector("[data-testid='custom-database']");
    expect(custom).not.toBeNull();
    expect(document.querySelector("[data-slot='docblocks/database']")).toBeNull();
  });
});

describe("the data provider (the useDatabaseTable's batch commit)", () => {
  afterEach(() => cleanup());

  it("the renameTable commits to the bridge's table (no doc write); the undo / redo walk the name back", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await bridge.createTable("Batch");
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    await act(async () => {
      await result.current.renameTable("Second Name");
    });
    expect((await bridge.describeTable(tableId)).name).toBe("Second Name");
    await act(async () => {
      await result.current.undo();
    });
    expect((await bridge.describeTable(tableId)).name).toBe("Batch");
    await act(async () => {
      await result.current.redo();
    });
    expect((await bridge.describeTable(tableId)).name).toBe("Second Name");
  });

  it("the table.renamed event stands on the peer's bridge over the channel echo", async () => {
    const sharedChannel = `rename-echo-${Math.random().toString(36).slice(2, 8)}`;
    const a = createMemoryDatabaseBridge({ channelName: sharedChannel });
    const b = createMemoryDatabaseBridge({ channelName: sharedChannel });
    // A's table stands on B's state over the created echo (the shared
    // demo table of the two panes / tabs — the same id on both sides).
    const tableId = await a.createTable("Demo");
    const seenDeadline = Date.now() + 2000;
    let seen = false;
    while (!seen) {
      if (Date.now() > seenDeadline) throw new Error("the table.created echo did not arrive");
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen = (await b.listTables()).some((entry) => entry.id === tableId);
    }
    await a.renameTable(tableId, "Echo Name");
    // The echo is the channel's message event: poll the peer's state
    // (the sleep yields to the macrotask queue, where the message lands).
    const deadline = Date.now() + 2000;
    let name = (await b.describeTable(tableId)).name;
    while (name !== "Echo Name") {
      if (Date.now() > deadline) throw new Error(`the rename echo did not arrive (name: ${name})`);
      await new Promise((resolve) => setTimeout(resolve, 5));
      name = (await b.describeTable(tableId)).name;
    }
  });

  it("the table id stands derived from the name (deterministic over the channel's instances)", async () => {
    const sharedChannel = `identity-${Math.random().toString(36).slice(2, 8)}`;
    const a = createMemoryDatabaseBridge({ channelName: sharedChannel });
    const b = createMemoryDatabaseBridge({ channelName: sharedChannel });
    // The two instances' identically-named tables share one deterministic
    // id (the two tabs' demo seed): a tableId reference created in A
    // resolves in B (the per-page data model of the e2e panes).
    const tableA = await a.createTable("Demo");
    const tableB = await b.createTable("Demo");
    expect(tableA).toBe(tableB);
    // The different names stand separate tables (the old `table-1`
    // collision of the two tabs' own tables is gone).
    const projectsA = await a.createTable("Projects");
    const projectsB = await b.createTable("Projects");
    expect(projectsA).toBe(projectsB);
    expect(projectsA).not.toBe(tableA);
    // The created / schema echoes stand the table + the column on the
    // peer's state (the adopted table stands under the same id).
    await a.createColumn(tableA, { id: "t", name: "T", type: "text" });
    const schemaDeadline = Date.now() + 2000;
    for (;;) {
      const description = await b.describeTable(tableB).catch(() => null);
      if (description !== null && description.columns.some((column) => column.id === "t")) break;
      if (Date.now() > schemaDeadline) throw new Error("the column echo did not settle on B");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    // The row ids stay deterministic and the counter syncs over the echo:
    // A's insert stands on B, and B's next insert never reuses A's id.
    const firstRow = await a.insertRow(tableA, { t: "from-a" });
    const settleDeadline = Date.now() + 2000;
    for (;;) {
      const page = await b.queryRows(tableB, {});
      if (page.rows[firstRow] !== undefined) break;
      if (Date.now() > settleDeadline) throw new Error("the row echo did not settle on B");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const secondRow = await b.insertRow(tableB, { t: "from-b" });
    expect(secondRow).not.toBe(firstRow);
    // Both sides converge on both rows.
    const convergeDeadline = Date.now() + 2000;
    for (;;) {
      const page = await a.queryRows(tableA, {});
      if (page.rows[firstRow] !== undefined && page.rows[secondRow] !== undefined) {
        expect(Object.keys(page.rows)).toHaveLength(2);
        break;
      }
      if (Date.now() > convergeDeadline) throw new Error("the row echoes did not converge on A");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });

  it("the updateRows stands ONE commit: the single undo restores every touched row (the redo stands the batch again)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const tableId = await bridge.createTable("Batch");
    await bridge.createColumn(tableId, { id: "t", name: "T", type: "text" });
    await bridge.createColumn(tableId, { id: "n", name: "N", type: "integer" });
    await bridge.insertRows(tableId, [
      { t: "a", n: 1 },
      { t: "b", n: 2 },
    ]);
    const ids = Object.keys((await bridge.queryRows(tableId, {})).rows);
    const r1 = ids[0]!;
    const r2 = ids[1]!;
    const { result } = renderHook(() => useDatabaseTable(bridge, tableId));
    await until(() => result.current.phase === "ready", "the load");
    await act(async () => {
      await result.current.updateRows([
        { rowId: r1, cells: { t: null, n: null } },
        { rowId: r2, cells: { t: null, n: null } },
      ]);
    });
    let page = await bridge.queryRows(tableId, {});
    expect(page.rows[r1]!.t ?? null).toBeNull();
    expect(page.rows[r2]!.t ?? null).toBeNull();
    expect(result.current.canUndo).toBe(true);
    // The single undo stands the WHOLE batch back (both rows).
    await act(async () => {
      await result.current.undo();
    });
    page = await bridge.queryRows(tableId, {});
    expect(page.rows[r1]!.t).toBe("a");
    expect(page.rows[r1]!.n).toBe(1);
    expect(page.rows[r2]!.t).toBe("b");
    expect(page.rows[r2]!.n).toBe(2);
    // The redo stands the batch again (the single press).
    await act(async () => {
      await result.current.redo();
    });
    page = await bridge.queryRows(tableId, {});
    expect(page.rows[r1]!.t ?? null).toBeNull();
    expect(page.rows[r2]!.t ?? null).toBeNull();
  });

  it("a superseded load's reject keeps the retried ready grid (the stale error stands no state)", async () => {
    const base = createMemoryDatabaseBridge();
    const tableId = await base.createTable("Stale");
    await base.createColumn(tableId, { id: "t", name: "T", type: "text" });
    // Each describeTable call holds on its own gate: the first (the initial
    // load) stays pending until the test rejects it, the second (the
    // retry's load) resolves and stands the ready state.
    const gates: Array<{ p: Promise<void>; resolve: () => void; reject: (error: Error) => void }> = [];
    const bridge: DatabaseBridge = {
      ...base,
      describeTable: (id: string) => {
        let resolve!: () => void;
        let reject!: (error: Error) => void;
        const p = new Promise<void>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        gates.push({ p, resolve, reject });
        return p.then(() => base.describeTable(id));
      },
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
});

describe("the slash Database picker (the rework: the create form + the search)", () => {
  /** A bridge with two seeded tables + a spied `createTable`. */
  function mockBridge() {
    const tables = [
      { id: "t-demo", name: "Demo" },
      { id: "t-zebra", name: "Zebra Board" },
    ];
    const base = createMemoryDatabaseBridge();
    const createTable = vi.fn(async (name: string) => `t-${name.toLowerCase().replace(/\s+/g, "-")}`);
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
    expect(createTable).toHaveBeenCalledWith("My Board");
    expect(onCommit).toHaveBeenCalledWith("t-my-board");
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
    expect(createTable).toHaveBeenCalledWith("My Board");
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
});

describe("the filter builder — the ref value inputs (the enum's dict options / the row-link's displays)", () => {
  const statusCol: BridgeColumn = {
    id: "status",
    name: "Status",
    type: "text",
    refKind: "enum",
    refTableId: "table-statuses",
  };
  const ownerCol: BridgeColumn = {
    id: "owner",
    name: "Owner",
    type: "text",
    refKind: "row",
    refTableId: "table-people",
  };
  const refTableData: RefTableDataMap = {
    [refEntryKey({ tableId: "table-statuses" })]: {
      rowIds: ["todo", "done"],
      displays: { todo: "todo", done: "done" },
      colors: {},
    },
    [refEntryKey({ tableId: "table-people" })]: {
      rowIds: ["r-people-1"],
      displays: { "r-people-1": "Ann" },
      colors: {},
    },
  };

  it("stands the ref table's displays over the enum and the row-link conditions (the pick commits the value)", () => {
    // The controlled stand: the payload lives in the test component's
    // state (the builder's `value` prop re-renders over the draft
    // changes).
    function Harness({ onPayload }: { onPayload: (next: DatabaseFilterPayload | null) => void }) {
      const [payload, setPayload] = useState<DatabaseFilterPayload | null>(null);
      return (
        <FilterBuilder
          value={payload}
          columns={[statusCol, ownerCol]}
          onChange={(next) => {
            setPayload(next);
            onPayload(next);
          }}
          refTableData={refTableData}
        />
      );
    }
    const payloads: (DatabaseFilterPayload | null)[] = [];
    render(<Harness onPayload={(next) => payloads.push(next)} />);
    // The empty filter stands no condition yet — the add-condition press
    // stands the first row (over the first column — the enum):
    // the value select stands the dict's options.
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/filter-add-condition']")!);
    const condition = () => document.querySelector<HTMLElement>("[data-slot='docblocks/filter-condition']")!;
    expect(condition().getAttribute("data-column-id")).toBe("status");
    const valueSelect = () => condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-value']")!;
    expect([...valueSelect().options].map((entry) => entry.value)).toEqual(["", "todo", "done"]);

    // The row-link's condition stands the linked table's rows over the
    // displays (the join over the bridge), the pick commits the row id.
    fireEvent.change(condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-column']")!, {
      target: { value: "owner" },
    });
    expect(condition().getAttribute("data-column-id")).toBe("owner");
    const ownerSelect = condition().querySelector<HTMLSelectElement>("[data-slot='docblocks/filter-value']")!;
    expect([...ownerSelect.options].map((entry) => `${entry.value}|${entry.textContent}`)).toEqual([
      "|—",
      "r-people-1|Ann",
    ]);
    fireEvent.change(ownerSelect, { target: { value: "r-people-1" } });
    expect(payloads.at(-1)?.conditions[0]?.value).toBe("r-people-1");
  });
});

describe("the enum's options' mechanics (the system table; the create / the edit's form; the chip's display)", () => {
  it("the system table stands hidden (the listTables stands it out; the echo carries the flag)", async () => {
    const sharedChannel = `enum-system-${Math.random().toString(36).slice(2, 8)}`;
    const a = createMemoryDatabaseBridge({ channelName: sharedChannel });
    const b = createMemoryDatabaseBridge({ channelName: sharedChannel });
    const id = await a.createTable("Tags-enum", { system: true });
    // The hidden stand: the consumer's catalog reads it out.
    expect(await a.listTables()).toEqual([]);
    // The schema / rows stay reachable by id (the grid's ref read).
    const description = await a.describeTable(id);
    expect(description.name).toBe("Tags-enum");
    // The echo carries the flag (the peer's catalog stands it out too).
    const seenDeadline = Date.now() + 2000;
    for (;;) {
      if (Date.now() > seenDeadline) throw new Error("the system table's echo did not arrive");
      const tables = await b.listTables();
      const descriptionB = await b.describeTable(id).catch(() => null);
      if (descriptionB !== null && tables.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect((await b.describeTable(id)).name).toBe("Tags-enum");
    expect((await b.listTables()).map((table) => table.id)).not.toContain(id);
  });

  it("the enum's create form stands the options' editor (the reordering, the colors, the delete; the system table's commit)", async () => {
    const { bridge, tableId } = await renderGrid();
    const trigger = document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-trigger']")!;
    fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
    fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
    fireEvent.click(trigger);
    await until(() => document.querySelector("[data-column-entry='enum']") !== null, "the add-column menu");
    fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='enum']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-add-column-form']") !== null, "the form");
    // The options' editor stands (the ref table's pick is out for the enum).
    const form = () => document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-form']")!;
    expect(form().querySelector("[data-slot='docblocks/database-enum-options']")).not.toBeNull();
    expect(form().querySelector("[data-slot='docblocks/database-add-column-ref']")).toBeNull();
    // The name's prefill stands the type's label (the "Enum" stand).
    expect(form().querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!.value).toBe(
      "Enum"
    );

    const addOption = async (name: string) => {
      fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-add']")!);
      await settleGrid();
      const inputs = document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']");
      fireEvent.change(inputs[inputs.length - 1]!, { target: { value: name } });
      await settleGrid();
    };
    await addOption("alpha");
    await addOption("beta");
    await addOption("gamma");

    // The grip's drag stands the live reorder (the third over the first —
    // the pointer's delta stands the index's shift).
    const grips = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-grip']");
    fireEvent.pointerDown(grips[2]!, { clientX: 100, clientY: 400, button: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 400 - 36 * 2 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 400 - 36 * 2 });
    await settleGrid();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      )
    ).toEqual(["gamma", "alpha", "beta"]);

    // The delete's control drops the draft's row (the alpha's — the
    // colored's stand keeps the gamma's row over it).
    const deletes = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-delete']");
    fireEvent.click(deletes[1]!);
    await settleGrid();
    expect(
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      )
    ).toEqual(["gamma", "beta"]);

    // The color's stand (the palette's popover pick over the swatch): the
    // palette's popover stands portaled (the swatch's buttons stand the
    // background color's inline stand — the palette's red).
    const swatch = () => document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-color']")!;
    fireEvent.click(swatch());
    await settleGrid();
    const paletteButtons = [...document.querySelectorAll<HTMLElement>("button")].filter(
      (button) => button.style.backgroundColor === "rgb(247, 168, 168)"
    );
    expect(paletteButtons.length).toBeGreaterThan(0);
    fireEvent.click(paletteButtons.at(-1)!);
    await settleGrid();
    expect(swatch().getAttribute("data-color")).toBe("#f7a8a8");

    // The create's commit (the button's press): the system table's creation
    // + the options' rows + the column's `refTableId` reference.
    fireEvent.change(document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!, {
      target: { value: "Stage" },
    });
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-header-cell'][data-column-id='col5']") !== null,
      "the column"
    );
    const schema = await bridge.describeTable(tableId);
    const created = schema.columns.find((column) => column.id === "col5");
    expect(created?.refKind).toBe("enum");
    expect(created?.refTableId).not.toBeUndefined();
    const enumTableId = created!.refTableId!;
    // The hidden table stands the catalog out (the options are reachable
    // by id only).
    expect((await bridge.listTables()).map((table) => table.id)).not.toContain(enumTableId);
    const page = await bridge.queryRows(enumTableId, {});
    const optionRows = Object.values(page.rows).map((cells) => cells as Record<string, unknown>);
    expect(optionRows.map((cells) => cells.name)).toEqual(["gamma", "beta"]);
    expect(optionRows[0]?.color).toBe("#f7a8a8");
  });

  it("the enum's edit form stands the diff commit (the values stand; the names / the order / the colors update)", async () => {
    const { bridge, tableId } = await renderGrid();
    // The enum column over the fresh system table (the created stand).
    const enumTableId = await bridge.createTable("Stage-enum", { system: true });
    await bridge.createColumn(enumTableId, { id: "name", name: "name", type: "text" });
    await bridge.createColumn(enumTableId, { id: "color", name: "color", type: "text" });
    await bridge.insertRows(enumTableId, [{ name: "alpha", color: "#f7a8a8" }, { name: "beta" }]);
    await bridge.createColumn(tableId, {
      id: "stage",
      name: "Stage",
      type: "text",
      refKind: "enum",
      refTableId: enumTableId,
    });
    const page = await bridge.queryRows(tableId, {});
    const rowId = Object.keys(page.rows)[0]!;
    // The cell value stands the option's row id (the edit's identity).
    const alphaRowId = Object.keys((await bridge.queryRows(enumTableId, {})).rows)[0]!;
    await bridge.updateRow(tableId, rowId, { stage: alphaRowId });
    await settleGrid();
    const cell = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-cell'][data-column-id='stage']");
    await until(() => cell() !== null, "the cell");
    await until(() => (cell()!.textContent ?? "").includes("alpha"), "the display");

    // The edit's open (the column menu's "Edit options" entry — the
    // header's press stands the menu): the draft prefills from the system
    // table (the order's stand, the names, the colors).
    const stageHeader = () =>
      document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-cell'][data-column-id='stage']")!;
    const ellipsis = stageHeader().querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']")!;
    fireEvent.pointerDown(ellipsis, { clientX: 10, clientY: 5 });
    await until(
      () => document.querySelector("[data-slot='docblocks/database-column-edit-options']") !== null,
      "the edit entry"
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-column-edit-options']")!);
    await until(() => document.querySelector("[data-slot='docblocks/database-enum-options']") !== null, "the editor");
    const optionNames = () =>
      [...document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")].map(
        (input) => input.value
      );
    expect(optionNames()).toEqual(["alpha", "beta"]);
    // The color's swatch stands the committed hex (the alpha's red).
    const swatches = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-color']");
    expect(swatches[0]!.getAttribute("data-color")).toBe("#f7a8a8");

    // The diff: the rename (alpha → alfa), the option's add (gamma), the
    // reorder (gamma first).
    fireEvent.change(
      document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")[0]!,
      {
        target: { value: "alfa" },
      }
    );
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-enum-option-add']")!);
    await settleGrid();
    fireEvent.change(
      document.querySelectorAll<HTMLInputElement>("[data-slot='docblocks/database-enum-option-name']")[2]!,
      {
        target: { value: "gamma" },
      }
    );
    const grips = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-option-grip']");
    fireEvent.pointerDown(grips[2]!, { clientX: 100, clientY: 400, button: 0 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 400 - 36 * 2 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 400 - 36 * 2 });
    await settleGrid();
    expect(optionNames()).toEqual(["gamma", "alfa", "beta"]);
    fireEvent.click(document.querySelector<HTMLElement>("[data-slot='docblocks/database-add-column-create']")!);
    await settleGrid();
    await until(
      () => document.querySelector("[data-slot='docblocks/database-add-column-form']") === null,
      "the form's close"
    );

    // The diff's commit over the system table (the alpha's row stands its
    // id — the cell's value is intact; the names / the order updated).
    const afterPage = await bridge.queryRows(enumTableId, {});
    const ids = Object.keys(afterPage.rows);
    expect(ids).toHaveLength(3);
    expect(afterPage.rows[alphaRowId]!.name).toBe("alfa");
    expect(ids[0]).not.toBe(alphaRowId); // the gamma's stand is first
    expect(afterPage.rows[alphaRowId]!.color).toBe("#f7a8a8");

    // The cell's display stands the renamed option (the identity's
    // resolution over the row id).
    await until(() => (cell()!.textContent ?? "").includes("alfa"), "the renamed display");
    // The picker's list stands the new order + the renamed option (the
    // old name is gone).
    fireEvent.doubleClick(cell()!);
    await until(
      () => document.querySelector("[data-slot='docblocks/database-enum-picker-search']") !== null,
      "the picker"
    );
    const rows = [...document.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-enum-picker-row']")].map(
      (entry) => entry.textContent
    );
    expect(rows).toEqual(["gamma", "alfa", "beta"]);
  });

  it("the enum cell's chip stands the option's color (the empty stand stands the background only)", async () => {
    const { bridge, tableId } = await renderGrid();
    const enumTableId = await bridge.createTable("Color-enum", { system: true });
    await bridge.createColumn(enumTableId, { id: "name", name: "name", type: "text" });
    await bridge.createColumn(enumTableId, { id: "color", name: "color", type: "text" });
    await bridge.insertRows(enumTableId, [{ name: "green", color: "#97e3a8" }, { name: "plain" }]);
    await bridge.createColumn(tableId, {
      id: "tint",
      name: "Tint",
      type: "text",
      refKind: "enum",
      refTableId: enumTableId,
    });
    const page = await bridge.queryRows(tableId, {});
    const [rowA, rowB] = Object.keys(page.rows);
    const greenRowId = Object.keys((await bridge.queryRows(enumTableId, {})).rows)[0]!;
    await bridge.updateRow(tableId, rowA!, { tint: greenRowId });
    await settleGrid();
    const cellA = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='tint'][data-row='0']`
      )!;
    await until(() => cellA() !== null, "the cell");
    const chip = () => cellA().querySelector<HTMLElement>("[data-slot='docblocks/database-ref-chip']");
    await until(() => chip() !== null, "the chip");
    // The chip's background stands the option's color (the data's inline
    // stand), the label stands the option's name.
    expect(chip()!.style.backgroundColor).toBe("rgb(151, 227, 168)");
    expect(chip()!.textContent).toBe("green");
    // The no-color option stands the neutral chip (the muted background).
    const plainRowId = Object.keys((await bridge.queryRows(enumTableId, {})).rows)[1]!;
    await bridge.updateRow(tableId, rowB!, { tint: plainRowId });
    await settleGrid();
    const cellB = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='tint'][data-row='1']`
      )!;
    await until(() => cellB().querySelector("[data-slot='docblocks/database-ref-chip']") !== null, "the neutral chip");
    expect(cellB().querySelector<HTMLElement>("[data-slot='docblocks/database-ref-chip']")!.style.backgroundColor).toBe(
      ""
    );
    expect(cellB().getAttribute("data-empty")).not.toBe("true");
    // The empty stand: the cell's background only (no chip's box).
    await bridge.insertRow(tableId, { title: "c" });
    await settleGrid();
    const cellC = () =>
      document.querySelector<HTMLElement>(
        `[data-slot='docblocks/database-cell'][data-column-id='tint'][data-row='2']`
      )!;
    await until(() => cellC() !== null, "the empty cell");
    expect(cellC().querySelector("[data-slot='docblocks/database-ref-chip']")).toBeNull();
    expect(cellC().getAttribute("data-empty")).toBe("true");
  });
});
