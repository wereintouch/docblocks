// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId, Selection } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { EditorContextValue } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

// Captures the context at render time (the store handle for the selection
// slice assertions).
let context: EditorContextValue | null = null;
function ContextCapture() {
  context = useEditorContext();
  return null;
}

function renderDoc(prepare: (doc: TestDoc) => void): TestDoc {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  prepare(doc);
  render(
    <EditorProvider doc={doc}>
      <Editor />
      <ContextCapture />
    </EditorProvider>
  );
  return doc;
}

/** The wrapper element of the block. */
function wrapperOf(id: BlockId): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  expect(el, `the block ${id} should be rendered`).not.toBeNull();
  return el!;
}

/** The inner editable of the block's wrapper. */
function innerOf(id: BlockId): HTMLElement {
  const inner = wrapperOf(id).querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/**
 * Dispatch a keydown on the wrapper; false when the handler suppressed the
 * event (dispatchEvent returns false after preventDefault).
 */
function key(wrapper: HTMLElement, name: string, init: KeyboardEventInit = {}): boolean {
  let result = true;
  act(() => {
    result = wrapper.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })
    );
  });
  return result;
}

/** The local selection slice of the store. */
function storeSelection(): Selection {
  expect(context).not.toBeNull();
  return context!.store.getState().selection;
}

/**
 * Place the DOM caret at the flat character offset in the block's inner
 * editable (walking the text nodes across the run inlines).
 */
function caretAtFlat(id: BlockId, offset: number): void {
  const inner = innerOf(id);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let pos = 0;
  for (const child of Array.from(inner.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const length = child.nodeValue?.length ?? 0;
      nodes.push({ node: child as Text, start: pos, end: pos + length });
      pos += length;
    }
  }
  const at = nodes.find((n) => offset >= n.start && offset <= n.end);
  expect(at, `a text node should cover offset ${offset}`).toBeDefined();
  const range = document.createRange();
  range.setStart(at!.node, offset - at!.start);
  range.collapse(true);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  cleanup();
  context = null;
  window.getSelection()?.removeAllRanges();
});

describe("Tab: list nesting", () => {
  it("nests the second item under the first; Shift+Tab undoes it", () => {
    let l1: BlockId = "";
    let l2: BlockId = "";
    const doc = renderDoc((d) => {
      l1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l1, 0, "one");
      l2 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l2, 0, "two");
    });

    caretAtFlat(l2, 0);
    key(wrapperOf(l2), "Tab");

    const nested = doc.toJSON();
    const l1Json = nested.blocks[l1]!;
    expect("children" in l1Json ? l1Json.children : null).toEqual([l2]);
    expect(doc.getChildren(doc.meta.id)).toEqual([l1]);
    // The nested item renders inside the parent's nested list.
    expect(wrapperOf(l1).querySelector('[data-slot="docblocks/list"] li[data-block-id]')).not.toBeNull();

    key(wrapperOf(l2), "Tab", { shiftKey: true });

    const flat = doc.toJSON();
    expect("children" in flat.blocks[l1]!).toBe(false); // omitted when empty
    expect(doc.getChildren(doc.meta.id)).toEqual([l1, l2]);
  });

  it("does nothing without a previous list-item sibling", () => {
    let p: BlockId = "";
    let l1: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "x");
      l1 = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(l1, 0, "one");
    });

    caretAtFlat(l1, 0);
    const prevented = key(wrapperOf(l1), "Tab");

    expect(prevented).toBe(true); // not suppressed: the browser focus move runs
    expect(doc.getChildren(doc.meta.id)).toEqual([p, l1]);
  });
});

describe("blocks selection (gutter)", () => {
  it("a gutter click selects the block and Delete removes it", () => {
    let p1: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
    });
    const wrapper = wrapperOf(p1);
    const gutter = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/gutter"]');
    expect(gutter).not.toBeNull();

    act(() => {
      gutter!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });
    expect(wrapper.getAttribute("data-selected")).toBe("true");

    key(wrapper, "Delete");

    expect(doc.getBlock(p1)).toBeNull();
    expect(storeSelection()).toEqual({ kind: "none" });
  });

  it("shift+click extends the selection to a sibling range", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      p2 = d.insertBlock("paragraph");
      p3 = d.insertBlock("paragraph");
    });

    act(() => {
      wrapperOf(p1)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    act(() => {
      wrapperOf(p3)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, shiftKey: true }));
    });

    // The range is ordered by siblings, anchored at the first click.
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1, p2, p3], anchorId: p1 });
  });

  it("the arrows move a single-block selection and Escape clears it", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      p2 = d.insertBlock("paragraph");
    });

    act(() => {
      wrapperOf(p1)
        .querySelector<HTMLElement>('[data-slot="docblocks/gutter"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });

    key(wrapperOf(p1), "ArrowDown");
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p2], anchorId: p2 });
    // Focus follows the selection (DOM-only).
    expect(document.activeElement).toBe(wrapperOf(p2));

    key(wrapperOf(p2), "ArrowUp");
    expect(storeSelection()).toEqual({ kind: "blocks", ids: [p1], anchorId: p1 });

    key(wrapperOf(p1), "Escape");
    expect(storeSelection()).toEqual({ kind: "none" });
    expect(doc.getChildren(doc.meta.id)).toEqual([p1, p2]);
  });
});
