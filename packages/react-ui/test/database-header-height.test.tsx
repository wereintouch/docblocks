// @vitest-environment jsdom
// The external-form grid's header-row height: the block's attr (the
// document-level stand), the table section's value (the consumer's
// per-table stand — the block's attr wins), the auto stand, the drag over
// the header's bottom edge (the clamp's floor + the one commit on the
// release), and the read-only stand (the height applies, the handle is
// gone).
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { DatabaseBlock } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { DatabaseBridge, DatabaseTableSection, MutationContext } from "../src/database";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// The radix primitives drive the grid's interactions through the
// pointer-capture API, which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** The write context (a fresh operation id per call). */
function ctx(): MutationContext {
  return newMutationContext();
}

/** Waits for the grid's async load to settle (the ready phase). */
async function settleGrid() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

let bridge: DatabaseBridge;
let tableId: string;

beforeEach(async () => {
  bridge = createMemoryDatabaseBridge();
  tableId = (await bridge.createTable({ name: "Tasks" }, ctx())).result.id;
  const title = (
    await bridge.createColumn(tableId, { column: { name: "Title", type: "text", position: 0, nullable: true } }, ctx())
  ).result.id;
  await bridge.batchRows(tableId, { ops: [{ op: "create", row: { [title]: "a" }, beforeRowId: null }] }, ctx());
});

afterEach(() => cleanup());

/** Renders the document with one database block over the seeded table. */
async function renderGrid(options: {
  attrs?: Record<string, unknown>;
  section?: DatabaseTableSection;
  mode?: "edit" | "view";
}): Promise<{ doc: TestDoc; db: string }> {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  const db = doc.insertBlock("database", { tableId, ...(options.attrs ?? {}) });
  render(
    <EditorProvider doc={doc} databaseBridge={bridge} databaseTableSection={options.section} mode={options.mode}>
      <Editor />
    </EditorProvider>
  );
  await settleGrid();
  return { doc, db };
}

/** The grid's own header-row track stand (the inline style). */
function headerTrack(): string {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/database-table']")!.style.gridTemplateRows;
}

function headerHandle(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-slot='docblocks/database-header-resize']");
}

/** The block's committed header height (the attr's read). */
function attrHeight(doc: TestDoc, db: string): number | undefined {
  return (doc.getBlock(db) as DatabaseBlock | null)?.attrs.headerHeight;
}

describe("the grid's header-row height", () => {
  it("an absent stand keeps the auto height and renders the resize handle", async () => {
    await renderGrid({});
    expect(headerTrack()).toBe("auto");
    expect(headerHandle()).not.toBeNull();
  });

  it("the block's attr stands the header track", async () => {
    await renderGrid({ attrs: { headerHeight: 96 } });
    expect(headerTrack()).toBe("96px");
  });

  it("the section's value applies to a block without its own attr; the block's attr wins over it", async () => {
    const section: DatabaseTableSection = { getHeaderHeight: (id) => (id === tableId ? 120 : undefined) };
    await renderGrid({ section });
    expect(headerTrack()).toBe("120px");
    cleanup();

    const withAttr = await renderGrid({ section, attrs: { headerHeight: 96 } });
    expect(headerTrack()).toBe("96px");
    expect(attrHeight(withAttr.doc, withAttr.db)).toBe(96);
  });

  it("the drag previews the height, commits one attr on the release, and stands undo-able", async () => {
    const { doc, db } = await renderGrid({ attrs: { headerHeight: 96 } });
    const handle = headerHandle()!;
    // The live preview is view state (the doc stands until the release).
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 160 });
    expect(headerTrack()).toBe("156px");
    expect(attrHeight(doc, db)).toBe(96);
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 160 });
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(156);
    expect(headerTrack()).toBe("156px");

    // The commit is one doc transaction: undo reverts it.
    doc.undo();
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(96);
  });

  it("the drag never stands below the auto height (the clamp's floor)", async () => {
    const { doc, db } = await renderGrid({ attrs: { headerHeight: 96 } });
    const handle = headerHandle()!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 0 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 0 });
    await settleGrid();
    // The header stands unlaid-out in the unit runtime: the one-line floor.
    expect(attrHeight(doc, db)).toBe(28);
    expect(headerTrack()).toBe("28px");
  });

  it("the first drag over the auto height stands the attr (the one-line floor is the press's base)", async () => {
    const { doc, db } = await renderGrid({});
    expect(headerTrack()).toBe("auto");
    const handle = headerHandle()!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 140 });
    await settleGrid();
    // The header stands unlaid-out in the unit runtime: the auto stand is
    // the one-line floor (28 px), the drag's delta lands over it.
    expect(attrHeight(doc, db)).toBe(68);
    expect(headerTrack()).toBe("68px");
  });

  it("a drag back to the press's height stands no write", async () => {
    const { doc, db } = await renderGrid({ attrs: { headerHeight: 96 } });
    const handle = headerHandle()!;
    fireEvent.pointerDown(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 140 });
    fireEvent.pointerMove(handle, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(handle, { clientX: 100, clientY: 100 });
    await settleGrid();
    expect(attrHeight(doc, db)).toBe(96);
  });

  it("the read-only stand applies the height and renders no handle", async () => {
    await renderGrid({ attrs: { headerHeight: 96 }, mode: "view" });
    expect(headerTrack()).toBe("96px");
    expect(headerHandle()).toBeNull();
  });
});
