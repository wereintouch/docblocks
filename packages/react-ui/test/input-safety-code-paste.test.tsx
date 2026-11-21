// @vitest-environment jsdom
// The code block's paste target (the raw text's stand: the plain payload
// over the html's presence, the exact whitespace's keep, the CRLF's
// normalization to the doc's LF).
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/editor-provider";
import { CREATED_AT, blockCount, caretAt, dispatchPaste } from "./input-safety.helpers";
import type { TestDoc } from "./input-safety.helpers";

describe("the code paste target (the raw text)", () => {
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
});
