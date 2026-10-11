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

/** The (single) paragraph element of the rendered editor. */
function paragraphOf(doc: TestDoc): HTMLElement {
  const el = document.querySelector(`[data-block-id="${paragraphIdOf(doc)}"]`);
  expect(el, "the paragraph should be rendered").not.toBeNull();
  return el as HTMLElement;
}

/** Place the DOM caret at `offset` of the paragraph's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the paragraph should have a text node").not.toBeNull();
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
  it("renders the block text in a contenteditable element", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello world");
    });

    const el = paragraphOf(doc);
    expect(el.tagName).toBe("P");
    expect(el.textContent).toBe("hello world");
    expect(el.getAttribute("contenteditable")).toBe("true");
    expect(el.getAttribute("spellcheck")).toBe("false");
    expect(el.getAttribute("data-block-type")).toBe("paragraph");
  });

  it("applies a simulated input as a doc edit and undo restores it", () => {
    const doc = renderDoc((d) => {
      const id = d.insertBlock("paragraph");
      d.insertText(id, 0, "hello");
    });
    const id = paragraphIdOf(doc);
    const el = paragraphOf(doc);
    const textNode = el.firstChild!;

    // Simulate typing: the browser edits the text node in place and fires
    // a bubbling input event (React's onInput picks it up).
    act(() => {
      textNode.nodeValue = "hello world";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(doc.getText(id)).toBe("hello world");
    expect(el.textContent).toBe("hello world");
    expect(doc.canUndo).toBe(true);

    act(() => {
      doc.undo();
    });
    expect(doc.getText(id)).toBe("hello");
    // No selection inside the block: the text DOM re-syncs from the store.
    expect(el.textContent).toBe("hello");
  });

  it("commits typing into an empty block", () => {
    const doc = renderDoc((d) => {
      d.insertBlock("paragraph");
    });
    const id = paragraphIdOf(doc);
    const el = paragraphOf(doc);
    expect(el.textContent).toBe("");

    // Simulate the browser creating the first text node on the first
    // keystroke.
    act(() => {
      el.appendChild(document.createTextNode("x"));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(doc.getText(id)).toBe("x");
    expect(el.textContent).toBe("x");
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
    const strong = el.querySelector("strong");
    expect(strong).not.toBeNull();
    const plain = el.childNodes[1]!;
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
