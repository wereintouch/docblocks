// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { DatabaseAttrs } from "docblocks-core";

import { DatabaseTable } from "../src";
import { Editor } from "../src/Editor";
import type { DatabaseBridge, DatabaseTableSection, MutationContext } from "../src/database";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";
import { DocblocksI18nProvider } from "../src/i18n";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanup());

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function ctx(): MutationContext {
  return newMutationContext();
}

async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function seedGrid(options: { columns?: number; rows?: number } = {}) {
  const bridge = createMemoryDatabaseBridge();
  const columnCount = options.columns ?? 1;
  const rowCount = options.rows ?? 2;
  const tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const columnIds: string[] = [];
  for (let index = 0; index < columnCount; index += 1) {
    const column = await bridge.createColumn(
      tableId,
      { column: { name: index === 0 ? "Title" : `Count ${index}`, type: "text", position: index, nullable: true } },
      ctx()
    );
    columnIds.push(column.result.id);
  }
  if (columnIds.length > 0 && rowCount > 0) {
    await bridge.batchRows(
      tableId,
      {
        ops: Array.from({ length: rowCount }, (_, index) => ({
          op: "create" as const,
          row: { [columnIds[0]!]: index === 0 ? "a" : "b" },
          beforeRowId: null,
        })),
      },
      ctx()
    );
  }
  return { bridge, tableId, titleId: columnIds[0] };
}

async function renderGrid(options: {
  bridge: DatabaseBridge;
  tableId: string;
  attrs?: Partial<DatabaseAttrs>;
  section?: DatabaseTableSection;
  locale?: "en" | "ru";
}) {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = doc.insertBlock("database", { tableId: options.tableId, ...options.attrs });
  render(
    <DocblocksI18nProvider locale={options.locale}>
      <EditorProvider doc={doc} databaseBridge={options.bridge} databaseTableSection={options.section}>
        <Editor />
      </EditorProvider>
    </DocblocksI18nProvider>
  );
  await settleGrid();
  return { doc, db };
}

function slot(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-slot='docblocks/${name}']`);
  if (element === null) throw new Error(`Missing slot ${name}`);
  return element;
}

async function openTextForm() {
  const trigger = slot("database-add-column-trigger");
  fireEvent.pointerDown(trigger, { clientX: 10, clientY: 5 });
  fireEvent.pointerUp(trigger, { clientX: 10, clientY: 5 });
  fireEvent.click(trigger);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.click(document.querySelector<HTMLElement>("[data-column-entry='text']")!);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return document.querySelector<HTMLInputElement>("[data-slot='docblocks/database-add-column-name']")!;
}

describe("the database grid's chrome polish", () => {
  it("stands icon history buttons, the toolbar add-row action, and the framed rounded grid", async () => {
    const seeded = await seedGrid({ columns: 2, rows: 1 });
    await renderGrid(seeded);

    const undo = slot("database-undo");
    const redo = slot("database-redo");
    expect(undo.getAttribute("aria-label")).toBe("Undo");
    expect(undo.getAttribute("title")).toBe("Undo");
    expect(undo.querySelector("svg")).not.toBeNull();
    expect(undo.textContent).toBe("");
    expect(redo.getAttribute("aria-label")).toBe("Redo");
    expect(redo.querySelector("svg")).not.toBeNull();

    const addRow = slot("database-add-row");
    expect(slot("database-toolbar").contains(addRow)).toBe(true);
    expect(addRow.className).toContain("bg-accent");
    expect(addRow.className).toContain("select-none");
    expect(slot("database-table").className).toContain("border-(length:--docblocks-table-border-width)");
    expect(document.querySelectorAll("[data-slot='docblocks/database-header-cell']")[0]!.className).toContain(
      "rounded-tl-(--docblocks-radius)"
    );
    expect(slot("database-add-column").className).toContain("rounded-tr-(--docblocks-radius)");
    expect(document.querySelector("[data-slot='docblocks/database-cell']")!.className).toContain(
      "rounded-bl-(--docblocks-radius)"
    );
    expect(slot("database-row-menu").className).toContain("rounded-br-(--docblocks-radius)");
  });

  it("uses the consumer's total and adds the loaded visible count under an active filter", async () => {
    const seeded = await seedGrid();
    if (seeded.titleId === undefined) throw new Error("Missing title column");
    const section: DatabaseTableSection = { getRowCount: (id) => (id === seeded.tableId ? 42 : undefined) };
    await renderGrid({
      ...seeded,
      section,
      attrs: {
        filter: { logic: "and", conditions: [{ columnId: seeded.titleId, op: "is", value: "a" }] },
      },
    });
    expect(slot("database-count").textContent).toBe("42 rows");
    expect(slot("database-visible-count").textContent).toBe("1 shown");
  });

  it("falls back to the loaded count and applies the consumer total in the standalone grid", async () => {
    const fallback = await seedGrid();
    await renderGrid(fallback);
    expect(slot("database-count").textContent).toBe("2 rows");
    cleanup();

    const standalone = await seedGrid();
    const section: DatabaseTableSection = { getRowCount: () => 51 };
    render(<DatabaseTable bridge={standalone.bridge} tableId={standalone.tableId} tableSection={section} />);
    await settleGrid();
    expect(slot("database-count").textContent).toBe("51 rows");
  });

  it("re-reads the consumer total after a grid row mutation", async () => {
    const seeded = await seedGrid();
    const section: DatabaseTableSection = { getRowCount: (id) => seeded.bridge.getRowCount(id) };
    await renderGrid({ ...seeded, section });
    expect(slot("database-count").textContent).toBe("2 rows");
    fireEvent.click(slot("database-add-row"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(slot("database-count").textContent).toBe("3 rows");
  });

  it("disables filters without rows and columns without a schema", async () => {
    const noRows = await seedGrid({ rows: 0 });
    await renderGrid(noRows);
    expect(slot("database-filter")).toHaveProperty("disabled", true);
    expect(slot("database-columns")).toHaveProperty("disabled", false);
    cleanup();

    const noColumns = await seedGrid({ columns: 0, rows: 0 });
    await renderGrid(noColumns);
    expect(slot("database-empty").textContent).toContain("No columns yet.");
    expect(document.querySelector("[data-slot='docblocks/database-table']")).toBeNull();
    expect(slot("database-columns")).toHaveProperty("disabled", true);
    expect(slot("database-filter")).toHaveProperty("disabled", true);
    expect(slot("database-add-column-trigger").textContent).toContain("Add column");
  });

  it("prefills the new column's localized type name in the ru locale", async () => {
    const seeded = await seedGrid();
    await renderGrid({ ...seeded, locale: "ru" });
    expect((await openTextForm()).value).toBe("Текст");
  });
});
