// @vitest-environment jsdom
// The quote / the callout's gestures: the Enter's line break over the
// non-empty's lines, the empty's last line's exit, the wholly empty's
// conversion, and the Backspace's no-merge over the previous block.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, blockCount, caretAt } from "./input-safety.helpers";
import type { TestDoc } from "./input-safety.helpers";

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
