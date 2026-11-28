// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { DatabaseBlock } from "docblocks-core";

import { DatabaseTable } from "../src";
import { Editor } from "../src/Editor";
import type { DatabaseBridge, DatabaseTableSection, MutationContext } from "../src/database";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(async () => {
  bridge = createMemoryDatabaseBridge();
  tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const title = (
    await bridge.createColumn(tableId, { column: { name: "Title", type: "text", position: 0, nullable: true } }, ctx())
  ).result.id;
  await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [title]: "a" }, beforeRowId: null }] }, ctx());
});
afterEach(() => cleanup());

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;
let bridge: DatabaseBridge;
let tableId: string;

function ctx(): MutationContext {
  return newMutationContext();
}

async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderGrid(attrs: { height?: number } = {}, mode: "edit" | "view" = "edit") {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = doc.insertBlock("database", { tableId, ...attrs });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge} mode={mode}>
      <Editor />
    </EditorProvider>
  );
  await settleGrid();
  return { doc, db };
}

function blockElement(): HTMLElement {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/block'][data-block-type='database']")!;
}

function resizeHandle(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/database-resize']");
}

function attrHeight(doc: TestDoc, db: string): number | undefined {
  return (doc.getBlock(db) as DatabaseBlock | null)?.attrs.height;
}

describe("the database block's height", () => {
  it("caps the auto stand at the header plus ten natural rows", async () => {
    await renderGrid();
    // The unit runtime has no layout: the header and row fallbacks apply.
    expect(blockElement().style.maxHeight).toBe("348px");
    expect(blockElement().style.height).toBe("");
    expect(resizeHandle()).not.toBeNull();
  });

  it("applies the explicit height and lets the grid scroll inside it", async () => {
    await renderGrid({ height: 420 });
    expect(blockElement().style.height).toBe("420px");
    expect(blockElement().style.maxHeight).toBe("");
    expect(document.querySelector("[data-slot='docblocks/database-grid']")!.className).toContain("min-h-0 flex-1");
  });

  it("previews without a write and commits one undo-able height on release", async () => {
    const { doc, db } = await renderGrid({ height: 420 });
    const update = vi.spyOn(doc, "updateBlock");
    const handle = resizeHandle()!;
    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 160, pointerId: 1 });
    expect(blockElement().style.height).toBe("480px");
    expect(attrHeight(doc, db)).toBe(420);
    expect(update).not.toHaveBeenCalled();

    fireEvent.pointerUp(handle, { clientY: 160, pointerId: 1 });
    await settleGrid();
    expect(update).toHaveBeenCalledTimes(1);
    expect(attrHeight(doc, db)).toBe(480);
    doc.undo();
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(420);
  });

  it("clamps the drag to the header plus three rows without a ceiling", async () => {
    const { doc, db } = await renderGrid({ height: 200 });
    const handle = resizeHandle()!;
    fireEvent.pointerDown(handle, { clientY: 200, button: 0, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientY: 0, pointerId: 1 });
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(124);

    fireEvent.pointerDown(handle, { clientY: 100, button: 0, pointerId: 2 });
    fireEvent.pointerMove(handle, { clientY: 2100, pointerId: 2 });
    fireEvent.pointerUp(handle, { clientY: 2100, pointerId: 2 });
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(2124);
  });

  it("applies the height in read-only mode without the handle", async () => {
    await renderGrid({ height: 420 }, "view");
    expect(blockElement().style.height).toBe("420px");
    expect(resizeHandle()).toBeNull();
  });

  it("leaves the standalone grid's consumer-controlled sizing untouched", async () => {
    const section: DatabaseTableSection = { getHeaderHeight: () => 40, setHeaderHeight: vi.fn() };
    render(<DatabaseTable bridge={bridge} tableId={tableId} tableSection={section} />);
    await settleGrid();
    expect(blockElement().style.height).toBe("");
    expect(blockElement().style.maxHeight).toBe("");
    expect(resizeHandle()).toBeNull();
  });
});
