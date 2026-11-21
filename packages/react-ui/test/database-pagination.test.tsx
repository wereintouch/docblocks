// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { fireEvent, render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge, MutationContext } from "../src/database/bridge";
import { newMutationContext } from "../src/database/use-database-table";
import { EditorProvider } from "../src/editor-provider";

// the grid's pagination spec — part 1 of 1.

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

describe("the grid's pagination (the page's cursor stands the Load more stand)", () => {
  it("the table over the page size stands the affordance; the press stands the continuation (the full page set)", async () => {
    const bridge = createMemoryDatabaseBridge();
    const table = await bridge.createTable({ name: "Big" }, ctx());
    const title = await bridge.createColumn(
      table.result.id,
      { column: { name: "Title", type: "text", position: 0, nullable: true } },
      ctx()
    );
    // The 201 rows stand over the page size (the 200's page set is NOT
    // the table's stand — the cursor stands the continuation).
    const ops = Array.from({ length: 201 }, (_, i) => ({
      op: "create" as const,
      row: { [title.result.id]: `row-${i}` },
      beforeRowId: null,
    }));
    await bridge.batchRows(table.result.id, { ops }, ctx());
    renderDoc((d) => d.insertBlock("database", { tableId: table.result.id }), undefined, bridge);
    await settleGrid();
    const cellSelector = `[data-slot='docblocks/database-cell'][data-column-id='${title.result.id}']`;
    const rowCount = () => document.querySelectorAll(cellSelector).length;
    // The first page stands the 200's bound + the affordance's stand.
    await until(() => rowCount() === 200, "the first page's rows stand rendered");
    const loadMore = document.querySelector("[data-slot='docblocks/database-load-more']");
    expect(loadMore).not.toBeNull();
    // The press stands the continuation: the fresh page's rows stand
    // appended (the 201st row lands), the affordance stands gone (the
    // tail's stand).
    fireEvent.click(loadMore!);
    await until(() => rowCount() === 201, "the continuation's rows stand appended");
    expect(document.querySelector("[data-slot='docblocks/database-load-more']")).toBeNull();
  });
});
