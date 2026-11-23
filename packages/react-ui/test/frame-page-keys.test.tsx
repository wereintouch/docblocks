// @vitest-environment jsdom
// The page-frame's key's guards: the Backspace-merge's guard (no merge
// into the frame — the frame's slot stands, no write) and the Delete's
// stand (the reference's removal; the canvas's frame survives).
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider, useEditorContext } from "../src/editor-provider";
import { CREATED_AT } from "./frame-page.helpers";

describe("the Backspace-merge's guard (no merge into the frame)", () => {
  /** Place the DOM caret at `offset` of the block's inner and press Backspace on the wrapper. */
  function backspaceAt(blockId: BlockId, offset: number): void {
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    expect(wrapper, "the block should stand").not.toBeNull();
    const inner = wrapper!.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]');
    expect(inner, "the block should carry the inner editable").not.toBeNull();
    const textNode = Array.from(inner!.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    const range = document.createRange();
    if (textNode !== undefined) range.setStart(textNode, offset);
    else range.setStart(inner!, 0);
    range.collapse(true);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    act(() => {
      wrapper!.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
    });
  }

  it("a Backspace at the start of the block after a page-frame stands no merge (the frame's slot stands, no write)", () => {
    const doc = createDoc({ id: "frame-page-backspace-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const before = doc.insertBlock("paragraph");
    doc.insertText(before, 0, "before");
    const pageFrame = doc.insertBlock("frame", { frameId: frame }, { parent: doc.meta.id, after: before });
    const after = doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: pageFrame });
    doc.insertText(after, 0, "after");
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );

    backspaceAt(after, 0);

    // The guard's no-op: the frame stands (the childless window's
    // unconditional stand — the surface's unconditional's parity), nothing
    // is merged, nothing is written.
    const frameBlock = doc.getBlock(pageFrame);
    expect(frameBlock?.type).toBe("frame");
    expect(frameBlock?.type === "frame" && frameBlock.attrs?.frameId).toBe(frame);
    expect(doc.getText(before)).toBe("before");
    expect(doc.getText(after)).toBe("after");
    expect(Object.keys(doc.toJSON().blocks).length).toBe(6); // root + surface + frame + before + after + the page-frame
  });
});

describe("the Delete's stand (the reference's removal; the canvas frame's survival)", () => {
  /** Seed the blocks' selection (the frame's id) through the provider's context. */
  function SelectionProbe({ onReady }: { onReady: (set: (ids: BlockId[]) => void) => void }) {
    const { selection } = useEditorContext();
    onReady((ids) => {
      selection.view?.set({ kind: "blocks", ids, anchorId: ids[0]! });
    });
    return null;
  }

  it("the selected page-frame's Delete removes the reference (the canvas frame survives — no cascade)", () => {
    const doc = createDoc({ id: "frame-page-delete-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const frame = doc.insertBlock("frame", { title: "The frame" }, { parent: surface });
    doc.setGeometry(frame, { x: 0, y: 0, w: 300, h: 200 });
    const pageFrame = doc.insertBlock("frame", { frameId: frame });
    const probe = { current: null as null | ((ids: BlockId[]) => void) };
    render(
      <EditorProvider doc={doc}>
        <Editor />
        <SelectionProbe onReady={(set) => (probe.current = set)} />
      </EditorProvider>
    );
    act(() => {
      probe.current!([pageFrame]);
    });
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/frame-page"][data-block-id="${pageFrame}"]`
    )!;
    fireEvent.keyDown(wrapper, { key: "Delete" });
    // The reference's removal (the standard page's selection-delete — the
    // removeBlock's no-cascade stand: the frame is childless, the canvas
    // frame + its surface's content stand untouched).
    expect(doc.getBlock(pageFrame)).toBeNull();
    expect(doc.getBlock(frame)?.type).toBe("frame");
    expect(doc.getBlock(surface)?.type).toBe("surface");
    expect(doc.getChildren(surface)).toContain(frame);
  });
});
