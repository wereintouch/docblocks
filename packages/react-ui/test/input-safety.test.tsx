// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";
type TestDoc = ReturnType<typeof createDoc>;

let paragraphId: BlockId = "";

/** Render a doc with one paragraph ("hello"); the id is captured by the prepare callback. */
function renderParagraph(text = "hello") {
  const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
  paragraphId = doc.insertBlock("paragraph");
  if (text !== "") doc.insertText(paragraphId, 0, text);
  render(
    <EditorProvider doc={doc}>
      <Editor />
    </EditorProvider>
  );
  return doc;
}

/** The rendered paragraph wrapper element. */
function paragraphEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${paragraphId}"]`);
  expect(el, "the paragraph should be rendered").not.toBeNull();
  return el!;
}

/** The paragraph's inner editable (the contenteditable element). */
function innerEl(): HTMLElement {
  const inner = paragraphEl().querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/** Place the DOM caret at `offset` of the inner editable's first text node. */
function caretAt(el: HTMLElement, offset: number): void {
  const textNode = Array.from(el.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  expect(textNode, "the inner editable should have a text node").not.toBeNull();
  const range = document.createRange();
  range.setStart(textNode!, offset);
  range.collapse(true);
  const selection = window.getSelection();
  expect(selection).not.toBeNull();
  selection!.removeAllRanges();
  selection!.addRange(range);
}

/** Dispatch a paste event whose clipboard holds the given plain text. */
function dispatchPaste(el: HTMLElement, plainText: string): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => (format === "text/plain" ? plainText : "") },
  });
  return el.dispatchEvent(event);
}

/** The total number of blocks in the doc. */
function blockCount(doc: TestDoc): number {
  return Object.keys(doc.toJSON().blocks).length;
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("text input safety", () => {
  it("Enter with no caret in the block is a no-op: prevented, no new block", () => {
    const doc = renderParagraph();
    const wrapper = paragraphEl();
    const inner = innerEl();
    const before = blockCount(doc);
    expect(inner.childNodes.length).toBe(1);

    // No DOM selection: the Enter gesture has no caret to split at. The
    // browser line split is still suppressed (dispatchEvent returns false).
    let prevented = true;
    act(() => {
      prevented = wrapper.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })
      );
    });

    expect(prevented).toBe(false);
    expect(blockCount(doc)).toBe(before);
    expect(inner.querySelectorAll("br, div").length).toBe(0);
    expect(inner.childNodes.length).toBe(1);
    expect(inner.firstChild!.nodeType).toBe(Node.TEXT_NODE);
    expect(inner.textContent).toBe("hello");
  });

  it("Shift+Enter does not split the block either", () => {
    const doc = renderParagraph();
    const wrapper = paragraphEl();
    const inner = innerEl();
    const before = blockCount(doc);

    act(() => {
      wrapper.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
      );
    });

    expect(blockCount(doc)).toBe(before);
    expect(inner.querySelectorAll("br, div").length).toBe(0);
    expect(inner.textContent).toBe("hello");
  });

  it("paste inserts plain text at the caret offset and keeps a single text node", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    caretAt(inner, 2);

    act(() => {
      dispatchPaste(inner, "xy");
    });

    expect(doc.getText(paragraphId)).toBe("hexyllo");
    expect(inner.querySelectorAll("br, div").length).toBe(0);
    expect(inner.childNodes.length).toBe(1);
    expect(inner.textContent).toBe("hexyllo");
    // The caret rebased across the doc-driven rebuild: an insertion exactly
    // at the offset does not move it (the core point rule).
    const selection = window.getSelection()!;
    expect(selection.anchorNode!.textContent).toBe("hexyllo");
    expect(selection.anchorOffset).toBe(2);
  });

  it("paste over a selection replaces the selected range", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    const textNode = inner.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 1);
    range.setEnd(textNode, 4); // "ell"
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      dispatchPaste(inner, "X");
    });

    expect(doc.getText(paragraphId)).toBe("hXo");
    expect(inner.textContent).toBe("hXo");
  });

  it("paste with the selection spanning marked runs (multiple text nodes) replaces the range", () => {
    const doc = renderParagraph();
    act(() => {
      doc.setMark(paragraphId, 0, 3, { type: "bold" });
    });
    const inner = innerEl();
    const strong = inner.querySelector("strong");
    const outer = Array.from(inner.childNodes).find((n) => n.nodeType === Node.TEXT_NODE);
    expect(strong).not.toBeNull();
    expect(outer).not.toBeUndefined();
    // Flat offsets 1..4 across the two text nodes ("hel" + "l").
    const range = document.createRange();
    range.setStart(strong!.firstChild!, 1);
    range.setEnd(outer!, 1);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    act(() => {
      dispatchPaste(inner, "X");
    });

    expect(doc.getText(paragraphId)).toBe("hXo");
  });

  it("paste is a single undo step", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    caretAt(inner, 5);

    act(() => {
      dispatchPaste(inner, "!!");
    });
    expect(doc.getText(paragraphId)).toBe("hello!!");

    doc.undo();
    expect(doc.getText(paragraphId)).toBe("hello");
  });

  it("ignores a paste with no selection", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    window.getSelection()!.removeAllRanges();

    act(() => {
      dispatchPaste(inner, "xy");
    });

    expect(doc.getText(paragraphId)).toBe("hello");
  });

  it("ignores an empty plain-text paste", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    caretAt(inner, 2);

    act(() => {
      dispatchPaste(inner, "");
    });

    expect(doc.getText(paragraphId)).toBe("hello");
  });
});
