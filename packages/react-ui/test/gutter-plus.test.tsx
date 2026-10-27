// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** Flushes the frame-scheduled DOM seats (the afterFrame fallback is a timer in jsdom). */
const flushFrames = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 40));

describe("the gutter's quick insert (the plus under the item)", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => {
    cleanup();
  });

  it("inserts an empty paragraph under the block and seats the caret", async () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const id: BlockId = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "hello");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const plus = container.querySelector<HTMLElement>('[data-slot="docblocks/gutter-plus"]');
    expect(plus, "the plus button should stand on the text row").not.toBeNull();

    fireEvent.click(plus as HTMLElement);

    const children = doc.getChildren(doc.meta.id);
    expect(children).toHaveLength(2);
    const inserted = doc.getBlock(children[1] as BlockId);
    expect(inserted).not.toBeNull();
    if (inserted !== null && "type" in inserted) {
      expect(inserted.type).toBe("paragraph");
      expect("content" in inserted).toBe(false);
    }

    // The caret seat is frame-scheduled: the new block's inner is focused
    // with a zero-length selection at the start.
    await flushFrames();
    const inner = container.querySelector<HTMLElement>(
      `[data-block-id="${children[1]}"][data-slot="docblocks/block-content"]`
    );
    expect(inner, "the inserted block should render its inner").not.toBeNull();
    expect(document.activeElement).toBe(inner);
    const selection = window.getSelection();
    expect(selection?.anchorNode).toBe(inner);
  });

  it("stands the block's indent on the inserted paragraph", () => {
    const doc = createDoc({ id: "doc-2", createdAt: CREATED_AT });
    const head: BlockId = doc.insertBlock("paragraph");
    doc.insertBlock("paragraph", { indent: 1 });
    const id: BlockId = doc.insertBlock("list-item", { list: "bullet", indent: 2 });

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const plus = container.querySelectorAll<HTMLElement>('[data-slot="docblocks/gutter-plus"]');
    // The indented item's own plus (the second row; the first row's plus
    // inserts at indent 0 and is the no-attr stand).
    const itemPlus = Array.from(plus).find((el) => el.closest<HTMLElement>("[data-block-id]")?.dataset.blockId === id);
    expect(itemPlus, "the item's own plus should stand").not.toBeUndefined();
    fireEvent.click(itemPlus as HTMLElement);

    const children = doc.getChildren(doc.meta.id);
    expect(children).toHaveLength(4);
    const inserted = doc.getBlock(children[3] as BlockId);
    expect(inserted?.type).toBe("paragraph");
    if (inserted !== null && "attrs" in inserted && inserted.attrs !== undefined) {
      expect((inserted.attrs as { indent?: number }).indent).toBe(2);
    }
    // One undo step (the insert is a single transact): the undo removes the
    // paragraph and the document stands as before.
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.getChildren(doc.meta.id)).toHaveLength(3);
    expect(doc.getBlock(id)?.type).toBe("list-item");
    expect(doc.getBlock(head)?.type).toBe("paragraph");
  });

  it("stands no plus over a canvas item (the plus is a page-sequence affordance)", () => {
    const doc = createDoc({ id: "doc-4", createdAt: CREATED_AT });
    const surfaceId: BlockId = doc.insertBlock("surface");
    const textId: BlockId = doc.insertBlock("canvas-text", undefined, { parent: surfaceId });
    doc.setGeometry(textId, { x: 0, y: 0, w: 200, h: 60 });
    doc.insertText(textId, 0, "on the canvas");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    // The canvas-text renders through the text renderer (the canvas item's
    // surface context): the grip stands (the selection-only stand), the
    // plus does not — its click would write a page paragraph into the
    // surface's children.
    const canvasText = container.querySelector<HTMLElement>(`[data-block-id="${textId}"]`);
    expect(canvasText).not.toBeNull();
    expect(canvasText?.querySelector('[data-slot="docblocks/gutter"]')).not.toBeNull();
    expect(canvasText?.querySelector('[data-slot="docblocks/gutter-plus"]')).toBeNull();
  });

  it("stands no plus inside a table cell (the gutter is a page affordance)", () => {
    const doc = createDoc({ id: "doc-3", createdAt: CREATED_AT });
    const tableId: BlockId = doc.insertBlock("table", { cols: 1 });
    const rowId: BlockId = doc.insertBlock("table-row", undefined, { parent: tableId });
    const cellId: BlockId = doc.insertBlock("table-cell", undefined, { parent: rowId });
    const paraId: BlockId = doc.insertBlock("paragraph", undefined, { parent: cellId });
    doc.insertText(paraId, 0, "cell text");

    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    // The cell's text block renders with the inCell context: no gutter and
    // no plus in its subtree (the affordance is a page-sequence one).
    const cellPara = container.querySelector<HTMLElement>(`[data-block-id="${paraId}"]`);
    expect(cellPara).not.toBeNull();
    expect(cellPara?.querySelector('[data-slot="docblocks/gutter-plus"]')).toBeNull();
  });
});
