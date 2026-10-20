// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/EditorProvider";
import type { EditorContextValue } from "../src/EditorProvider";

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

/** Dispatch a paste event whose clipboard holds the given plain text (and optionally the html). */
function dispatchPaste(el: HTMLElement, plainText: string, htmlText = ""): boolean {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (format: string) => (format === "text/plain" ? plainText : htmlText) },
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

describe("slash trigger (the page text blocks)", () => {
  let triggerId: BlockId = "";

  /** One text block of `kind` with `text`; `withSegment` adds a nested follower. An indented trigger needs a shallower head (the page sequence's jump rule). */
  function renderTrigger(
    kind: "paragraph" | "list-item" | "code",
    text: string,
    withSegment = false,
    indent = 0
  ): TestDoc {
    triggerId = "";
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    if (indent !== 0) doc.insertBlock("paragraph");
    const attrs: Record<string, unknown> = {};
    if (indent !== 0) attrs.indent = indent;
    if (kind === "list-item") attrs.list = "bullet";
    triggerId = doc.insertBlock(kind, Object.keys(attrs).length > 0 ? attrs : undefined);
    if (text !== "") doc.insertText(triggerId, 0, text);
    if (withSegment) {
      const child = doc.insertBlock("paragraph", { indent: indent + 1 });
      doc.insertText(child, 0, "nested");
    }
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    return doc;
  }

  /**
   * Seat a collapsed caret at `caretOffset` of the block's inner (on the
   * first text node; on the element for an empty inner) and press "/"; true
   * = the key's default was prevented (the editor commits the character —
   * the browser's insertion stands suppressed).
   */
  function pressSlash(wrapper: HTMLElement, inner: HTMLElement, caretOffset = 0): boolean {
    const textNode = Array.from(inner.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    if (textNode !== undefined) {
      range.setStart(textNode, caretOffset);
    } else {
      range.setStart(inner, 0);
    }
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    let prevented = false;
    act(() => {
      prevented = !wrapper.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }));
    });
    return prevented;
  }

  it("commits the / and opens the menu (the doc is the source of truth)", () => {
    const doc = renderTrigger("paragraph", "");
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${triggerId}"]`);
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!);

    expect(prevented).toBe(true);
    // The "/" stands in the doc as a regular character (Backspace deletes it
    // like any other through the normal input path).
    expect(doc.getText(triggerId)).toBe("/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("opens on a block that owns a derived segment (the apply never cascades)", () => {
    const doc = renderTrigger("paragraph", "", true);
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${triggerId}"]`);
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!);

    expect(prevented).toBe(true);
    expect(doc.getText(triggerId)).toBe("/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("opens on a non-empty, indented block (any position and indent of the page sequence)", () => {
    const doc = renderTrigger("list-item", "ab", false, 1);
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${triggerId}"]`);
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!, 2);

    expect(prevented).toBe(true);
    expect(doc.getText(triggerId)).toBe("ab/");
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).not.toBeNull();
  });

  it("does not open on a code block (a / in code is plain text)", () => {
    const doc = renderTrigger("code", "ab");
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${triggerId}"]`);
    expect(wrapper, "the trigger should be rendered").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the trigger should carry the inner editable").not.toBeNull();

    const prevented = pressSlash(wrapper!, inner!, 2);

    expect(prevented).toBe(false); // the character flows through the normal input path
    expect(document.querySelector('[data-slot="docblocks/slash-menu"]')).toBeNull();
    expect(doc.getText(triggerId)).toBe("ab"); // jsdom inserts nothing; the browser would add the "/"
  });
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

describe("quote and callout gestures (the Enter exit and the Backspace no-merge)", () => {
  let blockId: BlockId = "";

  /** Render a doc with the given text block (optionally after a preceding paragraph). */
  function renderTextBlock(blockType: "quote" | "callout", text: string, withPrev = false): TestDoc {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    if (withPrev) doc.insertText(doc.insertBlock("paragraph"), 0, "prev");
    blockId = doc.insertBlock(blockType);
    if (text !== "") doc.insertText(blockId, 0, text);
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    return doc;
  }

  function blockEl(): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    expect(el, "the block should be rendered").not.toBeNull();
    return el!;
  }

  function blockInner(): HTMLElement {
    const inner = blockEl().querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the block should carry the inner editable").not.toBeNull();
    return inner!;
  }

  /** Seat the caret on the (text-node-less) empty inner editable itself. */
  function caretAtEmpty(inner: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(inner);
    range.collapse(true);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    selection!.removeAllRanges();
    selection!.addRange(range);
  }

  it("Enter on a non-empty line is a line break (the Shift+Enter semantics)", () => {
    const doc = renderTextBlock("quote", "abc");
    const inner = blockInner();
    caretAt(inner, 3);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2); // root + the quote
    expect(doc.getText(blockId)).toBe("abc\n");
    expect(doc.getBlock(blockId)?.type).toBe("quote");
  });

  it("Enter on a non-empty callout line is a line break (the quote interactivity)", () => {
    const doc = renderTextBlock("callout", "abc");
    const inner = blockInner();
    caretAt(inner, 3);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2); // root + the callout — no split
    expect(doc.getText(blockId)).toBe("abc\n");
    expect(doc.getBlock(blockId)?.type).toBe("callout");
  });

  it("Enter on an empty line that is NOT the last line is a line break", () => {
    const doc = renderTextBlock("quote", "abc\n\ndef");
    const inner = blockInner();
    // The caret sits on the empty middle line (between the two breaks).
    caretAt(inner, 4);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getText(blockId)).toBe("abc\n\n\ndef");
    expect(doc.getBlock(blockId)?.type).toBe("quote");
  });

  it("Enter on the empty last line exits: the preceding lines stand as the block, a new paragraph takes the caret", () => {
    const doc = renderTextBlock("quote", "abc\n");
    const inner = blockInner();
    caretAt(inner, 4);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3); // root + the quote + the new paragraph
    expect(doc.getText(blockId)).toBe("abc");
    const rootId = doc.meta.id;
    const siblings = doc.getChildren(rootId);
    expect(siblings).toHaveLength(2);
    expect(siblings[0]).toBe(blockId);
    expect(doc.getBlock(siblings[1]!)?.type).toBe("paragraph");
  });

  it("Enter on the empty last line of a callout exits the same way (the quote interactivity)", () => {
    const doc = renderTextBlock("callout", "abc\n");
    const inner = blockInner();
    caretAt(inner, 4);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3);
    expect(doc.getText(blockId)).toBe("abc");
    expect(doc.getBlock(blockId)?.type).toBe("callout");
    const siblings = doc.getChildren(doc.meta.id);
    expect(doc.getBlock(siblings[1]!)?.type).toBe("paragraph");
  });

  it("Enter on a wholly empty quote converts it to a paragraph in place", () => {
    const doc = renderTextBlock("quote", "");
    const inner = blockInner();
    caretAtEmpty(inner);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getBlock(blockId)?.type).toBe("paragraph");
  });

  it("Enter on a wholly empty callout converts it to a paragraph in place (the quote interactivity)", () => {
    const doc = renderTextBlock("callout", "");
    const inner = blockInner();
    caretAtEmpty(inner);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getBlock(blockId)?.type).toBe("paragraph");
  });

  it("Backspace at offset 0 of a non-empty quote never merges with the previous block", () => {
    const doc = renderTextBlock("quote", "abc", true);
    const inner = blockInner();
    caretAt(inner, 0);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3); // root + prev + the quote
    expect(doc.getText(blockId)).toBe("abc");
    expect(doc.getBlock(blockId)?.type).toBe("quote");
  });

  it("Backspace at offset 0 of a non-empty callout never merges with the previous block (the quote interactivity)", () => {
    const doc = renderTextBlock("callout", "abc", true);
    const inner = blockInner();
    caretAt(inner, 0);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3); // root + prev + the callout
    expect(doc.getText(blockId)).toBe("abc");
    expect(doc.getBlock(blockId)?.type).toBe("callout");
  });

  it("Backspace at offset 0 of an empty quote resets it to a paragraph", () => {
    const doc = renderTextBlock("quote", "");
    const inner = blockInner();
    caretAtEmpty(inner);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getBlock(blockId)?.type).toBe("paragraph");
  });
});

describe("code gestures (the soft-line family: Enter line break / exit, Backspace no-merge)", () => {
  let blockId: BlockId = "";

  /** Render a doc with the given code block (optionally after a preceding paragraph). */
  function renderCodeBlock(text: string, withPrev = false): TestDoc {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    if (withPrev) doc.insertText(doc.insertBlock("paragraph"), 0, "prev");
    blockId = doc.insertBlock("code");
    if (text !== "") doc.insertText(blockId, 0, text);
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    return doc;
  }

  function blockEl(): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    expect(el, "the block should be rendered").not.toBeNull();
    return el!;
  }

  function blockInner(): HTMLElement {
    const inner = blockEl().querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the block should carry the inner editable").not.toBeNull();
    return inner!;
  }

  /** Seat the caret on the (text-node-less) empty inner editable itself. */
  function caretAtEmpty(inner: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(inner);
    range.collapse(true);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    selection!.removeAllRanges();
    selection!.addRange(range);
  }

  it("Enter on a non-empty line is a line break (no split)", () => {
    const doc = renderCodeBlock("abc");
    const inner = blockInner();
    caretAt(inner, 3);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2); // root + the code — no split
    expect(doc.getText(blockId)).toBe("abc\n");
    expect(doc.getBlock(blockId)?.type).toBe("code");
  });

  it("Enter on the empty last line exits: the preceding lines stand as the code, a new paragraph takes the caret", () => {
    const doc = renderCodeBlock("abc\n");
    const inner = blockInner();
    caretAt(inner, 4);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3);
    expect(doc.getText(blockId)).toBe("abc");
    expect(doc.getBlock(blockId)?.type).toBe("code");
    const siblings = doc.getChildren(doc.meta.id);
    expect(doc.getBlock(siblings[1]!)?.type).toBe("paragraph");
  });

  it("Enter on a wholly empty code block converts it to a paragraph in place", () => {
    const doc = renderCodeBlock("");
    const inner = blockInner();
    caretAtEmpty(inner);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getBlock(blockId)?.type).toBe("paragraph");
  });

  it("Backspace at offset 0 of a non-empty code block never merges with the previous block", () => {
    const doc = renderCodeBlock("abc", true);
    const inner = blockInner();
    caretAt(inner, 0);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(3); // root + prev + the code
    expect(doc.getText(blockId)).toBe("abc");
    expect(doc.getBlock(blockId)?.type).toBe("code");
  });

  it("Backspace at offset 0 of an empty code block resets it to a paragraph", () => {
    const doc = renderCodeBlock("");
    const inner = blockInner();
    caretAtEmpty(inner);

    act(() => {
      blockEl().dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });

    expect(blockCount(doc)).toBe(2);
    expect(doc.getBlock(blockId)?.type).toBe("paragraph");
  });
});

describe("the code/latex paste target (the raw text)", () => {
  let codeId: BlockId = "";

  /** A doc with one code block (the optional text). */
  function renderCode(text = ""): TestDoc {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    codeId = doc.insertBlock("code");
    if (text !== "") doc.insertText(codeId, 0, text);
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    return doc;
  }

  function codeInner(): HTMLElement {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${codeId}"]`);
    const inner = el?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the code block should carry the inner editable").not.toBeNull();
    return inner!;
  }

  /** Seat the caret on the (text-node-less) empty inner editable itself. */
  function caretAtEmpty(inner: HTMLElement): void {
    const range = document.createRange();
    range.selectNodeContents(inner);
    range.collapse(true);
    const selection = window.getSelection();
    expect(selection).not.toBeNull();
    selection!.removeAllRanges();
    selection!.addRange(range);
  }

  it("the code target stands the plain payload when the html is present (the indentation and the lines stand)", () => {
    const doc = renderCode();
    const inner = codeInner();
    caretAtEmpty(inner);

    act(() => {
      dispatchPaste(inner, "def main():\n    x = 1\n\n    return x", "<pre>def main():\n    x = 1</pre>");
    });

    // the raw text stands verbatim (the html pipeline's line-flattening
    // never runs on the code target)
    expect(doc.getText(codeId)).toBe("def main():\n    x = 1\n\n    return x");
    expect(blockCount(doc)).toBe(2); // root + the code
  });

  it("the code target keeps the exact whitespace (the tabs, the blank lines, the trailing newline)", () => {
    const doc = renderCode("start\n");
    const inner = codeInner();
    caretAt(inner, 6);

    act(() => {
      dispatchPaste(inner, "\ta\n\tb  \n");
    });

    expect(doc.getText(codeId)).toBe("start\n\ta\n\tb  \n");
  });

  it("the CRLF clipboard line endings normalize to the doc's LF", () => {
    const doc = renderCode();
    const inner = codeInner();
    caretAtEmpty(inner);

    act(() => {
      dispatchPaste(inner, "a\r\nb\rc");
    });

    expect(doc.getText(codeId)).toBe("a\nb\nc");
  });

  it("the latex target stands the plain payload when the html is present", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const id = doc.insertBlock("latex", { display: true });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    const inner = document.querySelector<HTMLElement>(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
    expect(inner, "the latex block should carry the inner editable").not.toBeNull();
    caretAtEmpty(inner!);

    act(() => {
      dispatchPaste(inner!, "$$ y = x $$\n$$ z $$", "<pre>$$ y = x $$</pre>");
    });

    expect(doc.getText(id)).toBe("$$ y = x $$\n$$ z $$");
  });
});

describe("the blocks (gutter) selection removal", () => {
  it("the delete key removes the selected rows and parks the focus on the editor root", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "one");
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, "two");

    let context: EditorContextValue | undefined;
    const Capture = () => {
      context = useEditorContext();
      return null;
    };
    render(
      <EditorProvider doc={doc}>
        <Editor />
        <Capture />
      </EditorProvider>
    );
    const view = context!.selection.view;
    expect(view, "the selection view should stand").not.toBeNull();
    act(() => {
      view!.set({ kind: "blocks", ids: [p1], anchorId: p1 });
    });

    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${p1}"]`);
    expect(wrapper, "the selected row should render").not.toBeNull();
    wrapper!.focus();
    act(() => {
      fireEvent.keyDown(wrapper!, { key: "Delete" });
    });

    // The selected row is gone (the doc and the DOM); the tail's text
    // block stands (the stand's no stand), so the focus parks on the
    // editor root (the undo hotkey reach).
    expect(doc.getBlock(p1)).toBeNull();
    expect(doc.getBlock(p2)).not.toBeNull();
    expect(document.querySelector(`[data-block-id="${p1}"]`)).toBeNull();

    // The deleted row unmounted with the focus: the editor root stands
    // focused so the undo hotkey reaches the doc.
    const root = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"]');
    expect(document.activeElement).toBe(root);
  });

  it("the delete key over the non-text tail stands the trailing empty paragraph (the caret's home)", () => {
    const doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const p1 = doc.insertBlock("paragraph");
    doc.insertText(p1, 0, "one");
    const divider = doc.insertBlock("divider");

    let context: EditorContextValue | undefined;
    const Capture = () => {
      context = useEditorContext();
      return null;
    };
    render(
      <EditorProvider doc={doc}>
        <Editor />
        <Capture />
      </EditorProvider>
    );
    const view = context!.selection.view;
    act(() => {
      view!.set({ kind: "blocks", ids: [divider], anchorId: divider });
    });

    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${divider}"]`);
    expect(wrapper, "the selected row should render").not.toBeNull();
    wrapper!.focus();
    act(() => {
      fireEvent.keyDown(wrapper!, { key: "Delete" });
    });

    // The divider is gone and the sequence stands an empty paragraph over
    // its end (the tail's guarantee — the non-text last block stands no
    // caret home and no delete stand). The removal and the stand share
    // the gesture's one undo step.
    expect(doc.getBlock(divider)).toBeNull();
    const sequence = doc.getChildren(doc.meta.id);
    expect(sequence).toHaveLength(2);
    const tailId = sequence[sequence.length - 1]!;
    expect(doc.getBlock(tailId)?.type).toBe("paragraph");
    expect(doc.getText(tailId)).toBe("");
  });
});
