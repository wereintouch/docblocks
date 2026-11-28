// @vitest-environment jsdom
// The page row's DOM anchors: every page row stamps `data-block-id` /
// `data-block-type` over its own wrapper (the consumer's block navigation
// — the table of contents' scroll to a heading by block id), over the
// edit's, the view's, and the published's renders.
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

/** The doc's page blocks as an id → type map (the read's source of truth). */
function blockTypesOf(doc: TestDoc): Map<string, string> {
  const types = new Map<string, string>();
  for (const id of doc.getChildren(doc.meta.id)) {
    const block = doc.getBlock(id);
    if (block !== null) types.set(id, block.type);
  }
  return types;
}

/** Assert every page row of the container carries the block's anchor attrs. */
function expectRowAnchors(container: HTMLElement, types: Map<string, string>): void {
  const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-slot="docblocks/row"]'));
  expect(rows.length, "one row per page block").toBe(types.size);
  for (const row of rows) {
    const id = row.getAttribute("data-block-id");
    expect(id, "the row's data-block-id should be stamped").not.toBeNull();
    const type = types.get(id as string);
    expect(type, `the row's id should name a page block (${id})`).toBeDefined();
    expect(row.getAttribute("data-block-type")).toBe(type);
  }
}

describe("the page row's block anchors (the data-block-id over every row)", () => {
  afterEach(cleanup);

  it("stamps the anchors over the edit's render (every page block, text and non-text)", () => {
    const doc = createDoc({ id: "doc-row-anchors-1", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("heading", { level: 2 }), 0, "Title");
    doc.insertText(doc.insertBlock("paragraph"), 0, "Body");
    const item: BlockId = doc.insertBlock("list-item", { list: "bullet", indent: 1 });
    doc.insertText(item, 0, "Item");
    doc.insertBlock("divider");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expectRowAnchors(container, blockTypesOf(doc));
  });

  it("stamps the anchors over the view's render (the read-only stand, the same renderer)", () => {
    const doc = createDoc({ id: "doc-row-anchors-2", createdAt: CREATED_AT });
    doc.insertText(doc.insertBlock("heading", { level: 1 }), 0, "Title");
    doc.insertBlock("divider");

    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    expectRowAnchors(container, blockTypesOf(doc));
  });

  it("stamps the anchors over the published's snapshot render (the nested provider's rows)", () => {
    const live = createDoc({ id: "doc-row-anchors-3", createdAt: CREATED_AT });
    live.insertText(live.insertBlock("paragraph"), 0, "LIVE");
    const snapshot = createDoc({ id: "doc-row-anchors-3", createdAt: CREATED_AT });
    snapshot.insertText(snapshot.insertBlock("heading", { level: 1 }), 0, "Published title");
    snapshot.insertBlock("divider");

    const { container } = render(
      <EditorProvider doc={live} mode="published" publishedDoc={snapshot}>
        <Editor />
      </EditorProvider>
    );
    expectRowAnchors(container, blockTypesOf(snapshot));
  });
});
