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

// Captures the context at render time; the selection handle is a stable
// ref object, so `.view` read later is the live event-time value.
let context: EditorContextValue | null = null;
function ContextCapture() {
  context = useEditorContext();
  return null;
}

/** The id of the (single) paragraph block of the doc. */
function paragraphIdOf(doc: TestDoc): BlockId {
  const blocks = doc.toJSON().blocks;
  const id = Object.keys(blocks).find((key) => blocks[key]?.type === "paragraph");
  expect(id, "the doc should have a paragraph").toBeDefined();
  return id!;
}

/**
 * Seed the doc with content before the render (the store seeds from the
 * doc's snapshot at mount), then render the provider + editor + capture.
 */
function renderDoc(prepare: (doc: TestDoc) => void) {
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

/** The (single) paragraph wrapper element of the rendered editor. */
function paragraphOf(doc: TestDoc): HTMLElement {
  const el = document.querySelector(`[data-block-id="${paragraphIdOf(doc)}"]`);
  expect(el, "the paragraph should be rendered").not.toBeNull();
  return el as HTMLElement;
}

/** The inner editable of a block wrapper (the contenteditable element). */
function innerOf(wrapper: HTMLElement): HTMLElement {
  const inner = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner as HTMLElement;
}

/** Place the DOM caret at `offset` of the inner editable's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const inner = innerOf(el);
  const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the inner editable should have a text node").not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

/** Trigger the mapping of the current DOM selection into the core view. */
function fireSelectionChange(): void {
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

/** The core selection currently held by the view. */
function viewSelection(): Selection {
  expect(context).not.toBeNull();
  const view = context!.selection.view;
  expect(view, "the selection view should be live after mount").not.toBeNull();
  return view!.get();
}

afterEach(() => {
  cleanup();
  context = null;
});

describe("TextBlock contenteditable editing", () => {
  it("renders the block text in an inner contenteditable of a wrapper", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello world");
    });

    const wrapper = paragraphOf(doc);
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.getAttribute("contenteditable")).toBeNull();
    expect(wrapper.getAttribute("data-block-type")).toBe("paragraph");
    expect(wrapper.getAttribute("data-slot")).toBe("docblocks/block");
    const inner = innerOf(wrapper);
    expect(inner.getAttribute("contenteditable")).toBe("true");
    expect(inner.getAttribute("spellcheck")).toBe("false");
    expect(inner.getAttribute("data-slot")).toBe("docblocks/block-content");
    expect(inner.getAttribute("data-block-id")).toBe(paragraphIdOf(doc));
    expect(inner.textContent).toBe("hello world");
  });

  it("applies a simulated input as a doc edit and undo restores it", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);
    const wrapper = paragraphOf(doc);
    const inner = innerOf(wrapper);
    const textNode = inner.firstChild!;

    // Simulate typing: the browser edits the text node in place and fires
    // a bubbling input event (React's onInput picks it up).
    act(() => {
      textNode.nodeValue = "hello world";
      inner.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(doc.getText(id)).toBe("hello world");
    expect(inner.textContent).toBe("hello world");
    expect(doc.canUndo).toBe(true);

    act(() => {
      doc.undo();
    });
    expect(doc.getText(id)).toBe("hello");
    // No selection inside the block: the text DOM re-syncs from the store.
    expect(inner.textContent).toBe("hello");
  });

  it("commits typing into an empty block", () => {
    const doc = renderDoc((d) => {
      d.insertBlock("paragraph");
    });
    const id = paragraphIdOf(doc);
    const inner = innerOf(paragraphOf(doc));
    expect(inner.textContent).toBe("");

    // Simulate the browser creating the first text node on the first
    // keystroke.
    act(() => {
      inner.appendChild(document.createTextNode("x"));
      inner.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(doc.getText(id)).toBe("x");
    expect(inner.textContent).toBe("x");
  });

  it("maps the DOM selection to the core selection view", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
      d.setMark(id, 0, 2, { type: "bold" });
    });
    const id = paragraphIdOf(doc);
    const el = paragraphOf(doc);

    // Two runs: <strong>he</strong>llo — flat offsets cross the inlines.
    const inner = innerOf(el);
    const strong = inner.querySelector("strong");
    expect(strong).not.toBeNull();
    const plain = inner.childNodes[1]!;
    expect(plain.nodeType).toBe(Node.TEXT_NODE);

    const range = document.createRange();
    range.setStart(strong!, 1); // a child-slot offset: after the single text child
    range.setEnd(plain, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireSelectionChange();

    const mapped = viewSelection();
    expect(mapped.kind).toBe("text");
    if (mapped.kind !== "text") return;
    expect(mapped.from).toEqual({ blockId: id, offset: 2 });
    expect(mapped.to).toEqual({ blockId: id, offset: 4 });
    expect(mapped.reverse).toBeUndefined();
  });

  it("rebases the DOM selection across a store-side text change", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);
    const el = paragraphOf(doc);

    caretAt(el, 2);
    fireSelectionChange();
    expect(viewSelection().kind).toBe("text");

    // A store-side (remote/undo-shape) change: the previous store text
    // equals the DOM text, so the delta over the store texts is exactly
    // the change to rebase the selection across.
    act(() => {
      doc.insertText(id, 0, "XY");
    });

    expect(doc.getText(id)).toBe("XYhello");
    // jsdom's Selection tracks addRange over the rebuilt text node, so the
    // restored caret position is assertable (the real caret is the e2e's
    // concern).
    const selection = window.getSelection()!;
    expect(selection.anchorNode).not.toBeNull();
    expect(selection.anchorNode!.textContent).toBe("XYhello");
    expect(selection.anchorOffset).toBe(4); // 2 rebased across the insert at 0
  });

  it("keeps the caret at the deletion start when a store-side delete covers it", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);
    const el = paragraphOf(doc);

    caretAt(el, 2);
    fireSelectionChange();

    // A store-side deletion covering the caret: the caret stays at the
    // deletion start (the core point rule).
    act(() => {
      doc.deleteText(id, 2, 4);
    });

    expect(doc.getText(id)).toBe("heo");
    const selection = window.getSelection()!;
    expect(selection.anchorNode!.textContent).toBe("heo");
    expect(selection.anchorOffset).toBe(2);
  });
});

describe("Task checkbox", () => {
  /** The id of the (single) list-item block of the doc. */
  function listItemIdOf(doc: TestDoc): BlockId {
    const blocks = doc.toJSON().blocks;
    const id = Object.keys(blocks).find((key) => blocks[key]?.type === "list-item");
    expect(id, "the doc should have a list item").toBeDefined();
    return id!;
  }

  /** The list item's attrs, narrowed (getBlock returns the Block union). */
  function listItemAttrs(doc: TestDoc, id: BlockId): { list: "bullet" | "number" | "task"; checked?: boolean } {
    const block = doc.getBlock(id);
    expect(block, "the list item should exist").not.toBeNull();
    if (block === null || block.type !== "list-item") throw new Error("expected a list-item block");
    return block.attrs;
  }

  it("renders a checkbox for a task item and toggles checked on click", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("list-item", { list: "task" });
      d.insertText(id, 0, "buy milk");
    });
    const id = listItemIdOf(doc);
    const wrapper = document.querySelector(`[data-block-id="${id}"]`);
    expect(wrapper).not.toBeNull();
    const box = wrapper!.querySelector<HTMLButtonElement>('[data-slot="docblocks/checkbox"]');
    expect(box, "a task item should render a checkbox").not.toBeNull();
    expect(box!.getAttribute("aria-checked")).toBe("false");

    act(() => box!.click());
    expect(listItemAttrs(doc, id)).toMatchObject({ checked: true });
    expect(box!.getAttribute("aria-checked")).toBe("true");

    act(() => box!.click());
    expect(listItemAttrs(doc, id)).toMatchObject({ checked: false });
    expect(box!.getAttribute("aria-checked")).toBe("false");
  });

  it("renders no checkbox for non-task list items", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(id, 0, "a bullet");
    });
    const id = listItemIdOf(doc);
    const wrapper = document.querySelector(`[data-block-id="${id}"]`);
    expect(wrapper!.querySelector('[data-slot="docblocks/checkbox"]')).toBeNull();
  });
});

describe("Collapse toggle", () => {
  it("hides the children on click (view state: no doc change) and restores them", () => {
    let parent: BlockId = "";
    let child: BlockId = "";
    const doc = renderDoc((d) => {
      parent = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(parent, 0, "parent");
      child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
      d.insertText(child, 0, "child");
    });
    const before = JSON.stringify(doc.toJSON());
    const wrapper = document.querySelector(`[data-block-id="${parent}"]`);
    expect(wrapper, "the parent list item should be rendered").not.toBeNull();
    const toggle = wrapper!.querySelector<HTMLButtonElement>(':scope > button[data-slot="docblocks/collapse"]');
    expect(toggle, "a list item with children should render a collapse toggle").not.toBeNull();
    expect(toggle!.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(`[data-block-id="${child}"]`), "the child should be visible").not.toBeNull();

    act(() => toggle!.click());

    expect(toggle!.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(`[data-block-id="${child}"]`), "the child should be hidden").toBeNull();
    expect(JSON.stringify(doc.toJSON()), "a collapse must not touch the doc").toBe(before);

    act(() => toggle!.click());
    expect(document.querySelector(`[data-block-id="${child}"]`), "the child should be back").not.toBeNull();
  });

  it("renders no toggle for a childless list item", () => {
    renderDoc((d) => {
      const id = d.insertBlock("list-item", { list: "bullet" });
      d.insertText(id, 0, "a leaf");
    });
    expect(document.querySelector('[data-slot="docblocks/collapse"]')).toBeNull();
  });
});
