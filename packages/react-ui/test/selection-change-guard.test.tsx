// @vitest-environment jsdom
// The selectionchange clobber guard: a `blocks` view (the gutter / canvas
// selection) has no DOM expression, so a selection settling outside the
// editables (the chrome, the stale residue, a `none` mapping) must not
// clobber it; a caret inside an editable still wins (the page's
// gutter→text click).
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useEffect } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId, Selection } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

interface ViewHandle {
  get: () => Selection;
  set: (selection: Selection) => void;
}

/** The provider's selection handle (the stable object whose `view` goes live on mount). */
interface SelectionHandle {
  view: ViewHandle | null;
}

function renderDocWithView(prepare: (doc: TestDoc) => void): {
  doc: TestDoc;
  selection: { current: SelectionHandle | null };
} {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  const selection: { current: SelectionHandle | null } = { current: null };
  function Probe() {
    const context = useEditorContext();
    useEffect(() => {
      selection.current = context.selection as SelectionHandle;
    }, [context.selection]);
    return null;
  }
  render(
    <EditorProvider doc={doc}>
      <Probe />
      <Editor />
    </EditorProvider>
  );
  return { doc, selection };
}

/** The text node of the block's inner editable. */
function textNodeOf(id: BlockId): Text {
  const inner = document.querySelector<HTMLElement>(`[data-block-id="${id}"][data-slot="docblocks/block-content"]`);
  expect(inner, "the block should carry the inner editable").not.toBeNull();
  const node = inner!.firstChild;
  expect(node, "the block should carry a text node").not.toBeNull();
  return node as Text;
}

/** A non-editable element outside every editor (the chrome residue seat). */
function chromeSeat(): HTMLElement {
  const seat = document.createElement("div");
  seat.textContent = "chrome";
  document.body.appendChild(seat);
  return seat;
}

function seatSelection(node: Node): void {
  const range = document.createRange();
  range.selectNodeContents(node);
  const selection = window.getSelection();
  if (selection === null) throw new Error("the jsdom selection is missing");
  selection.removeAllRanges();
  selection.addRange(range);
}

describe("the selectionchange clobber guard", () => {
  afterEach(cleanup);

  it("a residue outside the editables does not clobber a blocks view", async () => {
    const { doc, selection } = renderDocWithView((d) => {
      const p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      const p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    await waitFor(() => expect(selection.current?.view).not.toBeNull());
    const first = doc.getChildren(doc.meta.id)[0]!;
    const second = doc.getChildren(doc.meta.id)[1]!;

    selection.current!.view!.set({ kind: "blocks", ids: [first, second], anchorId: first });

    // The stale residue: the DOM selection collapsed on the non-editable
    // chrome seat (the mapping resolves to `none`).
    const seat = chromeSeat();
    act(() => {
      seatSelection(seat);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selection.current!.view!.get().kind).toBe("blocks");
    seat.remove();
  });

  it("a caret inside an editable still wins over a blocks view", async () => {
    const { doc, selection } = renderDocWithView((d) => {
      const p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      const p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    await waitFor(() => expect(selection.current?.view).not.toBeNull());
    const first = doc.getChildren(doc.meta.id)[0]!;
    const second = doc.getChildren(doc.meta.id)[1]!;

    selection.current!.view!.set({ kind: "blocks", ids: [first, second], anchorId: first });

    // A real caret move into the second block's editable: the mapping
    // expresses a text position — it stands.
    act(() => {
      seatSelection(textNodeOf(second));
      document.dispatchEvent(new Event("selectionchange"));
    });
    const next = selection.current!.view!.get();
    expect(next.kind).toBe("text");
    if (next.kind === "text") expect(next.from.blockId).toBe(second);
  });

  it("a text view is remapped as before (the guard is blocks-scoped)", async () => {
    const { doc, selection } = renderDocWithView((d) => {
      const p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      const p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });
    await waitFor(() => expect(selection.current?.view).not.toBeNull());
    const first = doc.getChildren(doc.meta.id)[0]!;

    selection.current!.view!.set({
      kind: "text",
      from: { blockId: first, offset: 0 },
      to: { blockId: first, offset: 3 },
      reverse: false,
    });

    // The same chrome residue remaps the text view to `none` (the
    // pre-existing behavior: only blocks views are guarded).
    const seat = chromeSeat();
    act(() => {
      seatSelection(seat);
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(selection.current!.view!.get().kind).toBe("none");
    seat.remove();
  });
});
