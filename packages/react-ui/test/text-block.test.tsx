// @vitest-environment jsdom
// The text block's contenteditable's editing (the input's commit, the
// undo's restore, the selection's mapping + the rebase across the
// store's change) and the task's checkbox (the toggle, the non-task's
// no-checkbox, the done's 30% fade).
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import {
  caretAt,
  fireSelectionChange,
  innerOf,
  paragraphIdOf,
  paragraphOf,
  renderDoc,
  viewSelection,
} from "./text-block.helpers";
import type { TestDoc } from "./text-block.helpers";

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
    const wrapper = document.querySelector(`[data-block-id="${id}"]:not([data-slot="docblocks/row"])`);
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
    const wrapper = document.querySelector(`[data-block-id="${id}"]:not([data-slot="docblocks/row"])`);
    expect(wrapper!.querySelector('[data-slot="docblocks/checkbox"]')).toBeNull();
  });

  it("a done task's content stands at 30% opacity (never struck); the chrome stands full; a stray checked on another kind does not fade", () => {
    let task: BlockId = "";
    let bullet: BlockId = "";
    const doc = renderDoc((d) => {
      task = d.insertBlock("list-item", { list: "task", checked: true });
      d.insertText(task, 0, "done");
      bullet = d.insertBlock("list-item", { list: "bullet", checked: true });
      d.insertText(bullet, 0, "stray");
    });
    void doc;
    const taskWrapper = document.querySelector(
      `[data-block-id="${task}"][data-slot="docblocks/list-item"], [data-block-id="${task}"][data-slot="docblocks/block"]`
    );
    // The fade stands on the inner content (the text composition) — not on
    // the block wrapper (the gutter grip and the marker-zone chrome stand
    // full).
    expect(taskWrapper?.className).not.toContain("opacity-30");
    const taskInner = document.querySelector(`[data-block-id="${task}"] [data-slot="docblocks/block-content"]`);
    expect(taskInner?.className).toContain("opacity-30");
    const bulletInner = document.querySelector(`[data-block-id="${bullet}"] [data-slot="docblocks/block-content"]`);
    expect(bulletInner?.className).not.toContain("opacity-30");
    expect(taskInner?.className).not.toContain("line-through");
    // The checkbox stands outside the faded subtree (a sibling of the inner
    // content, not a descendant of it).
    const checkbox = taskWrapper?.querySelector('[data-slot="docblocks/checkbox"]') ?? null;
    expect(checkbox, "the task should render its checkbox").not.toBeNull();
    expect(taskInner !== null && checkbox !== null && taskInner.contains(checkbox)).toBe(false);
  });
});
