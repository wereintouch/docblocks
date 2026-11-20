// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

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

  it("stands the mode over the root's data-mode hook (the view and the published's stand)", () => {
    const first = makeDoc("doc-readonly-6");
    const view = render(
      <EditorProvider doc={first.doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    expect(view.container.querySelector('[data-slot="docblocks/editor"]')?.getAttribute("data-mode")).toBe("view");
    cleanup();
    const second = makeDoc("doc-readonly-7");
    const published = render(
      <EditorProvider doc={second.doc} accessLevel="viewer">
        <Editor />
      </EditorProvider>
    );
    const root = published.container.querySelector('[data-slot="docblocks/editor"]');
    expect(root?.getAttribute("data-mode")).toBe("published");
    expect(root?.getAttribute("data-readonly")).toBe("true");
  });
});

/** Dispatch a copy event with a recording clipboard; the payload's formats. */
function dispatchCopy(el: HTMLElement): { prevented: boolean; plain: string; html: string } {
  const written: Record<string, string> = {};
  const event = new Event("copy", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (type: string, data: string) => (written[type] = data) },
  });
  const prevented = !el.dispatchEvent(event);
  return { prevented, plain: written["text/plain"] ?? "", html: written["text/html"] ?? "" };
}

/** The block's text node (the test docs carry one unmarked run per block). */
function textNodeOf(id: BlockId): Text {
  const inner = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
  expect(inner, `the block ${id} should be rendered`).not.toBeNull();
  return inner!.firstChild as Text;
}

/** A DOM selection from (block a, offset aOffset) to (block b, bOffset). */
function selectAcross(a: BlockId, aOffset: number, b: BlockId, bOffset: number): void {
  const range = document.createRange();
  range.setStart(textNodeOf(a), aOffset);
  range.setEnd(textNodeOf(b), bOffset);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

describe("the read-only modes' copy stand", () => {
  afterEach(() => {
    cleanup();
    window.getSelection()?.removeAllRanges();
  });

  /** Two paragraphs ("alpha", "beta") with the ids pinned. */
  function twoParagraphs(id: string): { doc: TestDoc; a: BlockId; b: BlockId } {
    const doc = createDoc({ id, createdAt: CREATED_AT });
    const a: BlockId = doc.insertBlock("paragraph");
    doc.insertText(a, 0, "alpha");
    const b: BlockId = doc.insertBlock("paragraph");
    doc.insertText(b, 0, "beta");
    return { doc, a, b };
  }

  it("the view's mode copies the selected text (the native range stands over the non-editable inners)", () => {
    const { doc, a, b } = twoParagraphs("doc-copy-1");
    const { container } = render(
      <EditorProvider doc={doc} mode="view">
        <Editor />
      </EditorProvider>
    );
    const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;
    selectAcross(a, 0, b, 4);
    const payload = dispatchCopy(root);
    expect(payload.prevented).toBe(true);
    expect(payload.plain).toBe("alpha\nbeta");
    expect(payload.html).toBe("<div>alpha</div><div>beta</div>");
  });

  it("the published's stand stands the copy off (the reader's selection stands no stand)", () => {
    const { doc, a, b } = twoParagraphs("doc-copy-2");
    const { container } = render(
      <EditorProvider doc={doc} accessLevel="viewer">
        <Editor />
      </EditorProvider>
    );
    const root = container.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;
    selectAcross(a, 0, b, 4);
    const payload = dispatchCopy(root);
    expect(payload.prevented).toBe(false);
    expect(payload.plain).toBe("");
    expect(payload.html).toBe("");
  });
});
