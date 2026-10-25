// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { EditorContextValue } from "../src/EditorProvider";
import { reseatHistorySelection } from "../src/editing/block-commands";
import { caretOffsetIn, selectionInside } from "../src/editing/dom-offset";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

/** The selection handle captured from the provider context by a probe child. */
type Captured = { ctx: EditorContextValue | null };

function Probe({ captured }: { captured: Captured }) {
  captured.ctx = useEditorContext();
  return null;
}

describe("the undo/redo selection re-seat (the history step's remount)", () => {
  afterEach(cleanup);

  it("re-seats the caret when the undo remounts the block (the type swap)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const id: BlockId = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "hello");

    const captured: Captured = { ctx: null };
    const { container } = render(
      <EditorProvider doc={doc}>
        <Editor />
        <Probe captured={captured} />
      </EditorProvider>
    );
    const view = captured.ctx?.selection.view ?? null;
    expect(view, "the selection view should be live after the mount effect").not.toBeNull();

    // Park the DOM caret at the end of the paragraph and mirror it into
    // the view (the selectionchange mapping's effect) — the pre-gesture
    // snapshot the undo restores.
    const inner = container.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`)!;
    inner.focus();
    const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    expect(textNode, "the inner should have a text node").not.toBeNull();
    const range = document.createRange();
    range.setStart(textNode as Node, 5);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    view!.set({ kind: "text", from: { blockId: id, offset: 5 }, to: null });

    // The type change remounts the block (the div -> li swap); the inverse
    // (the undo) remounts it back.
    act(() => {
      doc.changeBlockType(id, "list-item", { list: "bullet" });
    });
    act(() => {
      doc.undo();
    });

    // The remounted paragraph's inner stands without the DOM selection
    // (the old element is gone; the view holds the restored selection).
    const fresh = container.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`)!;
    expect(fresh, "the inner should have remounted").not.toBe(inner);
    expect(selectionInside(fresh)).toBe(false);
    const restored = view!.get();
    expect(restored.kind).toBe("text");
    if (restored.kind === "text") {
      expect(restored.from).toEqual({ blockId: id, offset: 5 });
      expect(restored.to).toBeNull();
    }

    // The hotkey's re-seat: the restored selection stands in the survivor
    // inner, with the focus.
    reseatHistorySelection(doc, view!, container);
    expect(selectionInside(fresh), "the caret should stand in the remounted inner").toBe(true);
    expect(document.activeElement).toBe(fresh);
    expect(caretOffsetIn(fresh, selection.anchorNode, selection.anchorOffset)).toBe(5);

    // A repeat of the re-seat is a no-op (the seat is already stood).
    reseatHistorySelection(doc, view!, container);
    expect(selectionInside(fresh)).toBe(true);
    expect(caretOffsetIn(fresh, selection.anchorNode, selection.anchorOffset)).toBe(5);
  });

  it("stands no seat for a non-text restored selection (the blocks kind)", () => {
    const doc = createDoc({ id: "doc-2", createdAt: CREATED_AT });
    const id: BlockId = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "hello");

    const captured: Captured = { ctx: null };
    render(
      <EditorProvider doc={doc}>
        <Editor />
        <Probe captured={captured} />
      </EditorProvider>
    );
    const view = captured.ctx?.selection.view ?? null;
    expect(view).not.toBeNull();
    // A blocks selection (the gutter select): the re-seat is a no-op (no
    // text caret to stand). The file's prior test leaves the global
    // selection behind (jsdom), so clear it for a clean stand.
    window.getSelection()?.removeAllRanges();
    view!.set({ kind: "blocks", ids: [id], anchorId: id });
    expect(() => reseatHistorySelection(doc, view!, document)).not.toThrow();
    const selection = window.getSelection();
    expect(selection?.rangeCount ?? 0).toBe(0);
  });
});
