// @vitest-environment jsdom
// The blocks' (gutter) selection's removal over the Delete's key (the row's
// removal + the caret's seat over the next text block, the non-text tail's
// trailing empty paragraph's stand).
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import type { EditorContextValue } from "../src/editor-provider";
import { CREATED_AT } from "./input-safety.helpers";

describe("the blocks (gutter) selection removal", () => {
  it("the delete key removes the selected row and seats the caret in the next text block", async () => {
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

    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${p1}"]:not([data-slot="docblocks/row"])`);
    expect(wrapper, "the selected row should render").not.toBeNull();
    wrapper!.focus();
    act(() => {
      fireEvent.keyDown(wrapper!, { key: "Delete" });
    });

    expect(doc.getBlock(p1)).toBeNull();
    expect(doc.getBlock(p2)).not.toBeNull();
    expect(document.querySelector(`[data-block-id="${p1}"]:not([data-slot="docblocks/row"])`)).toBeNull();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const nextInner = document.querySelector(`[data-block-id="${p2}"][data-slot="docblocks/block-content"]`);
    expect(document.activeElement).toBe(nextInner);
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

    const wrapper = document.querySelector<HTMLElement>(
      `[data-block-id="${divider}"]:not([data-slot="docblocks/row"])`
    );
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
