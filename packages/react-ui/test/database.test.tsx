// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { DatabaseColumn } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge } from "../src/database/bridge";
import { createMemoryDatabaseBridge } from "../src/database/memory-bridge";

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
    expect(wrapper!.querySelector('[data-slot="docblocks/block-content"]')).toBeNull();
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
    expect(custom!.getAttribute("data-custom-rows")).toBe("0");
    expect(document.querySelector('[data-slot="docblocks/database"]')).toBeNull();
  });
});
