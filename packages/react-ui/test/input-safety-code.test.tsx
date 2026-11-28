// @vitest-environment jsdom
// The code block's gestures (the soft-line family): the Enter's line break
// / the exit over the empty's last line, the wholly empty's conversion,
// and the Backspace's no-merge.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, blockCount, caretAt } from "./input-safety.helpers";
import type { TestDoc } from "./input-safety.helpers";

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
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]:not([data-slot="docblocks/row"])`);
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
