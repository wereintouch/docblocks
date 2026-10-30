// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { caretOffsetIn } from "../src/editing/dom-offset";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

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

/** The paragraph's inner editable (the contenteditable element). */
function innerEl(): HTMLElement {
  const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${paragraphId}"]`);
  const inner = wrapper?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
  expect(inner, "the wrapper should carry the inner editable").not.toBeNull();
  return inner!;
}

/** Place the DOM caret at `offset` of the inner editable's first text node (or the element start for an empty block). */
function caretAt(offset: number): void {
  const inner = innerEl();
  const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
  const range = document.createRange();
  if (textNode === undefined) range.setStart(inner, 0);
  else range.setStart(textNode, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

/** Select the flat range [from, to) of the inner editable. */
function selectRange(from: number, to: number): void {
  const inner = innerEl();
  const textNode = inner.firstChild!;
  const range = document.createRange();
  range.setStart(textNode, from);
  range.setEnd(textNode, to);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

/** Dispatch a paste event whose clipboard holds the given payload formats. */
function dispatchPaste(el: HTMLElement, formats: Record<string, string>): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => formats[format] ?? "" },
  });
  return el.dispatchEvent(event);
}

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("rich clipboard paste", () => {
  it("a rich paste over a selection replaces the range and carries the marks", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    // Select "ell" (flat offsets 1..4).
    selectRange(1, 4);

    act(() => {
      dispatchPaste(inner, {
        "text/html": '<strong>ab</strong> <a href="https://example.org">cd</a><span style="color:#ff0000">ef</span>',
        "text/plain": "ab cd ef",
      });
    });

    // The range was replaced; the runs carry the mapped marks.
    expect(doc.getText(paragraphId)).toBe("hab cdefo");
    expect(doc.getRuns(paragraphId)).toEqual([
      { text: "h", marks: {} },
      { text: "ab", marks: { bold: true } },
      { text: " ", marks: {} },
      { text: "cd", marks: { link: { href: "https://example.org" } } },
      { text: "ef", marks: { color: { value: "#ff0000" } } },
      { text: "o", marks: {} },
    ]);

    // The store-driven rebuild converged the DOM, and the caret landed after
    // the inserted text (the rebase path: from + inserted length).
    expect(inner.textContent).toBe("hab cdefo");
    const sel = window.getSelection()!;
    expect(inner.contains(sel.anchorNode)).toBe(true);
    expect(caretOffsetIn(inner, sel.anchorNode!, sel.anchorOffset)).toBe(8);
  });

  it("a rich paste at a collapsed caret inserts the runs at the caret", () => {
    const doc = renderParagraph("");
    const inner = innerEl();
    caretAt(0);

    act(() => {
      dispatchPaste(inner, { "text/html": "<em>xy</em>", "text/plain": "xy" });
    });

    expect(doc.getText(paragraphId)).toBe("xy");
    expect(doc.getRuns(paragraphId)).toEqual([{ text: "xy", marks: { italic: true } }]);
    expect(inner.querySelector("em")?.textContent).toBe("xy");
  });

  it("drops a disallowed href to the link-less text and keeps an allowed fragment", () => {
    const doc = renderParagraph("");
    const inner = innerEl();
    caretAt(0);

    act(() => {
      dispatchPaste(inner, { "text/html": '<a href="javascript:alert(1)">xy</a><a href="#sec">z</a>' });
    });

    // The javascript: link is dropped (the text stays); the fragment link survives.
    expect(doc.getRuns(paragraphId)).toEqual([
      { text: "xy", marks: {} },
      { text: "z", marks: { link: { href: "#sec" } } },
    ]);
    expect(doc.getText(paragraphId)).toBe("xyz");
  });

  it("keeps only the mapped style properties and the mapped tags", () => {
    const doc = renderParagraph("");
    const inner = innerEl();
    caretAt(0);

    act(() => {
      dispatchPaste(inner, {
        "text/html":
          '<span style="color:#123456; font-size:99px; background-color:#ff0000">ab</span>' +
          '<div style="color:#000000">cd</div><img src="x.png"><script>alert(1)</script>ef',
      });
    });

    // The span maps color and background-color, drops the rest; the div
    // wrapper stands its own paragraph (transparent to the structure), the
    // img and the script are excluded (the script content is metadata) —
    // three blocks, no raw nodes survive the store-driven rebuild.
    expect(doc.getText(paragraphId)).toBe("ab");
    expect(doc.getRuns(paragraphId)).toEqual([
      { text: "ab", marks: { color: { value: "#123456" }, highlight: { value: "#ff0000" } } },
    ]);
    const children = doc.getChildren(doc.meta.id).filter((id) => id !== paragraphId);
    expect(children).toHaveLength(2);
    expect(doc.getText(children[0]!)).toBe("cd");
    expect(doc.getBlock(children[0]!)?.type).toBe("paragraph");
    expect(doc.getText(children[1]!)).toBe("ef");
    expect(doc.getBlock(children[1]!)?.type).toBe("paragraph");
    expect(inner.querySelectorAll("img, script").length).toBe(0);
  });

  it("splits the multi-line HTML into the blocks at the block boundaries", () => {
    const doc = renderParagraph("");
    const inner = innerEl();
    caretAt(0);

    act(() => {
      dispatchPaste(inner, { "text/html": "<p>one</p><p>two</p>" });
    });

    // The first block merges into the caret block; the second stands its
    // own paragraph (the block boundaries stand the blocks).
    expect(doc.getText(paragraphId)).toBe("one");
    expect(doc.getRuns(paragraphId)).toEqual([{ text: "one", marks: {} }]);
    const children = doc.getChildren(doc.meta.id).filter((id) => id !== paragraphId);
    expect(children).toHaveLength(1);
    expect(doc.getBlock(children[0]!)?.type).toBe("paragraph");
    expect(doc.getText(children[0]!)).toBe("two");
  });

  it("a code block receives the flattened text without marks", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const codeId = doc.insertBlock("code", { language: "ts" });
    doc.insertText(codeId, 0, "ab");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${codeId}"]`);
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]')!;
    const range = document.createRange();
    range.setStart(inner, 0);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);

    act(() => {
      dispatchPaste(inner, { "text/html": "<strong>xy</strong>" });
    });

    expect(doc.getText(codeId)).toBe("xyab");
    expect(doc.getRuns(codeId)).toEqual([{ text: "xyab", marks: {} }]);
  });

  it("an empty rich payload falls back to the plain path", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    caretAt(2);

    act(() => {
      dispatchPaste(inner, { "text/html": "", "text/plain": "XY" });
    });
    expect(doc.getText(paragraphId)).toBe("heXYllo"); // the plain path ran
  });

  it("a paste without text/html runs the plain path untouched", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    caretAt(2);

    act(() => {
      dispatchPaste(inner, { "text/plain": "Z" });
    });
    expect(doc.getRuns(paragraphId)).toEqual([{ text: "heZllo", marks: {} }]); // no marks from plain text
  });

  it("a rich paste over a range is a single undo step", () => {
    const doc = renderParagraph();
    const inner = innerEl();
    selectRange(1, 4);

    act(() => {
      dispatchPaste(inner, { "text/html": "<b>q</b>", "text/plain": "q" });
    });
    expect(doc.getText(paragraphId)).toBe("hqo");

    act(() => {
      doc.undo();
    });
    expect(doc.getText(paragraphId)).toBe("hello");
    expect(doc.getRuns(paragraphId)).toEqual([{ text: "hello", marks: {} }]);
  });
});
