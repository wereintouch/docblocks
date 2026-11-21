// @vitest-environment jsdom
import { createMemoryDatabaseBridge } from "@playground/memory-bridge";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createDoc } from "docblocks-core";
import type { DatabaseColumn } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import type { DatabaseBridge } from "../src/database/bridge";
import { EditorProvider } from "../src/editor-provider";

// the renderer registry spec — part 1 of 1.

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
