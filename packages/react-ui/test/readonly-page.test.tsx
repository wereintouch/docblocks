// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** A doc with a text block and an undo step behind it (the hotkey's target). */
function makeDoc(id: string, text = "live text"): { doc: ReturnType<typeof createDoc>; blockId: BlockId } {
  const doc = createDoc({ id, createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, text);
  return { doc, blockId };
}

describe("the page's read-only stand (the view / published's modes)", () => {
  afterEach(cleanup);

  it("stands the inner not editable and the gutter's handles off (the view's mode)", () => {
    const { doc, blockId } = makeDoc("doc-readonly-1");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
    );
    expect(inner?.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
    expect(container.querySelector('[data-slot="docblocks/gutter-plus"]')).toBeNull();
    const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(root?.getAttribute("data-readonly")).toBe("true");
  });

  it("stands the editable stand and the gutter's handles over the edit's mode (the default)", () => {
    const { doc, blockId } = makeDoc("doc-readonly-2");
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector<HTMLElement>(
      `[data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
    );
    expect(inner?.getAttribute("contenteditable")).toBe("true");
    expect(container.querySelector('[data-slot="docblocks/gutter"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/gutter-plus"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="docblocks/editor"]')?.getAttribute("data-readonly")).toBeNull();
  });

  it("the undo's hotkey stands no stand over the view's mode (the doc stays untouched)", () => {
    const { doc } = makeDoc("doc-readonly-3");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(root).not.toBeNull();
    fireEvent.keyDown(root as HTMLElement, { key: "z", metaKey: true, bubbles: true });
    expect(doc.getTextLength(doc.getChildren(doc.meta.id)[0]!)).toBe("live text".length);
  });

  it("the viewer's stand is the same read-only stand (the access level's gate — the doc IS the snapshot)", () => {
    // The security's stand: the viewer's doc is the published snapshot (the
    // consumer passes only the stand the reader may see — no live doc, no
    // separate snapshot prop).
    const snapshot = createDoc({ id: "doc-readonly-4", createdAt: CREATED_AT });
    const snapshotId: BlockId = snapshot.insertBlock("paragraph");
    snapshot.insertText(snapshotId, 0, "published text");
    const { container } = render(
      <EditorProvider doc={snapshot} accessLevel="viewer">
        <Editor />
      </EditorProvider>
    );
    const inner = container.querySelector<HTMLElement>(
      `[data-block-id="${snapshotId}"][data-slot="docblocks/block-content"]`
    );
    expect(inner?.getAttribute("contenteditable")).toBe("false");
    expect(container.querySelector('[data-slot="docblocks/gutter"]')).toBeNull();
  });

  it("the task's checkbox stands disabled over the view's mode (the check stands visible)", () => {
    const doc = createDoc({ id: "doc-readonly-5", createdAt: CREATED_AT });
    const blockId: BlockId = doc.insertBlock("list-item", { list: "task", checked: true });
    doc.insertText(blockId, 0, "done");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const checkbox = container.querySelector<HTMLElement>('[data-slot="docblocks/checkbox"]');
    expect(checkbox).not.toBeNull();
    expect(checkbox?.hasAttribute("disabled")).toBe(true);
  });
});
