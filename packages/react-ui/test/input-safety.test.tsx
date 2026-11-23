// @vitest-environment jsdom
// The page text's input safety: the Enter / the Shift+Enter's line break
// and the paste's pipeline over the selection's stands.
import { describe, expect, it } from "vitest";

import { act } from "react";

import {
  blockCount,
  caretAt,
  dispatchPaste,
  innerEl,
  paragraphEl,
  paragraphId,
  renderParagraph,
} from "./input-safety.helpers";

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

  it("Shift+Enter inserts a line break in the run text without splitting", () => {
    const doc = renderParagraph();
    const wrapper = paragraphEl();
    const inner = innerEl();
    const before = blockCount(doc);
    caretAt(inner, 2);

    act(() => {
      wrapper.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true })
      );
    });

    // One `\n` in the run text: the block is not split, the rebuilt DOM
    // carries the break as a character (no <br>/<div>), the caret lands
    // after it (offset 3 of "he\nllo").
    expect(blockCount(doc)).toBe(before);
    expect(doc.getText(paragraphId)).toBe("he\nllo");
    expect(inner.querySelectorAll("br, div").length).toBe(0);
    expect(inner.textContent).toBe("he\nllo");
    const selection = window.getSelection();
    expect(selection?.anchorNode?.nodeType).toBe(Node.TEXT_NODE);
    expect(selection?.anchorOffset).toBe(3);
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
    // The caret stands at the end of the pasted content (the markdown
    // pipeline's C7 landing — before the block's own suffix).
    const selection = window.getSelection()!;
    expect(selection.anchorNode!.textContent).toBe("hexyllo");
    expect(selection.anchorOffset).toBe(4);
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
