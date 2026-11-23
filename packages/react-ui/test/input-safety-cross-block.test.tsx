// @vitest-environment jsdom
// The cross-block's paste over the no-seam's full-range's replace: the
// full-document's range's rich / the plain payload, the whitespace's
// payload's stand, and the replace's undo's step.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";
import type { BlockId, SelectionView } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { EditorContextValue } from "../src/editor-provider";
import { CREATED_AT, dispatchPaste } from "./input-safety.helpers";
import type { TestDoc } from "./input-safety.helpers";

describe("the cross-block paste (the no-seam's full-range's replace)", () => {
  let doc: TestDoc;
  let firstId: BlockId = "";
  let lastId: BlockId = "";
  let view: SelectionView | null = null;

  /** Three paragraphs ("first line" / "second line" / "third line"). */
  function renderThree(): void {
    doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    firstId = doc.insertBlock("paragraph");
    doc.insertText(firstId, 0, "first line");
    doc.insertText(doc.insertBlock("paragraph"), 0, "second line");
    lastId = doc.insertBlock("paragraph");
    doc.insertText(lastId, 0, "third line");

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
    view = context!.selection.view;
  }

  /** The Ctrl+A's stand: the full cross-block range (the first block's start → the last block's end). */
  function selectWholeDocument(): void {
    const length = doc.getText(lastId).length;
    act(() => {
      view!.set({ kind: "text", from: { blockId: firstId, offset: 0 }, to: { blockId: lastId, offset: length } });
    });
  }

  /** The root's children's texts (the document's readable content). */
  function rootTexts(): string[] {
    return doc.getChildren(doc.meta.id).map((id) => doc.getText(id));
  }

  function firstInner(): HTMLElement {
    const el = document.querySelector<HTMLElement>(
      `[data-block-id="${firstId}"] [data-slot="docblocks/block-content"]`
    );
    expect(el, "the first block's inner should stand").not.toBeNull();
    return el!;
  }

  it("the full-document's range's rich paste replaces the document (the no-seam's stand — nothing dropped)", () => {
    renderThree();
    selectWholeDocument();
    act(() => {
      dispatchPaste(firstInner(), "replaced one\nreplaced two", "<p>replaced one</p><p>replaced two</p>");
    });
    expect(rootTexts()).toEqual(["replaced one", "replaced two"]);
  });

  it("the full-document's range's plain paste stands the markdown's pipeline (the no-seam's seat's stand)", () => {
    renderThree();
    selectWholeDocument();
    act(() => {
      dispatchPaste(firstInner(), "# a heading\nbody text");
    });
    const sequence = doc.getChildren(doc.meta.id);
    expect(doc.getBlock(sequence[0]!)?.type).toBe("heading");
    expect(rootTexts()).toEqual(["a heading", "body text"]);
  });

  it("the whitespace's payload leaves the editable seat (the dead-state's no-stand)", () => {
    renderThree();
    selectWholeDocument();
    act(() => {
      dispatchPaste(firstInner(), "   ");
    });
    const sequence = doc.getChildren(doc.meta.id);
    expect(sequence).toHaveLength(1);
    expect(doc.getBlock(sequence[0]!)?.type).toBe("paragraph");
    expect(doc.getText(sequence[0]!)).toBe("");
  });

  it("the replace's undo restores the original's blocks (one undo step)", () => {
    renderThree();
    selectWholeDocument();
    act(() => {
      dispatchPaste(firstInner(), "replaced one\nreplaced two", "<p>replaced one</p><p>replaced two</p>");
    });
    doc.undo();
    expect(rootTexts()).toEqual(["first line", "second line", "third line"]);
  });
});
