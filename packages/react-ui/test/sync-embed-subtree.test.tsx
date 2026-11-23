// @vitest-environment jsdom
// The subtree's projection (the derived's segment): the re-derive over
// the change — the peer's insert's grow, the removal's shrink, the
// untouched's block's identity's keep.
import { describe, expect, it } from "vitest";

import { act } from "react";

import { renderOuter, wrapperOf } from "./sync-embed.helpers";

describe("subtree projection (the derived segment)", () => {
  it("re-derives on change: a peer insert into the segment grows it, a removal shrinks it, the untouched blocks keep identity", () => {
    const { master } = renderOuter({ docId: "master-1", blockId: "m0003" });
    const wrapper = wrapperOf()!;
    const editor = wrapper.querySelector<HTMLElement>('[data-slot="docblocks/editor"]')!;
    expect(editor).not.toBeNull();

    // The seed: the segment is the subtree root alone (m0004 follows at
    // indent 0 — outside the segment).
    expect(editor.querySelector('[data-block-id="m0003"]')).not.toBeNull();
    expect(editor.querySelector('[data-block-id="m0004"]')).toBeNull();
    const firstM0003 = editor.querySelector<HTMLElement>('[data-block-id="m0003"]')!;

    // An unrelated change (m0002 stands outside the segment): the
    // re-derivation runs, the segment stands, and the subtree root's node
    // is not remounted (the store keeps the block's snapshot reference).
    act(() => {
      master.insertText("m0002", 0, "Edited ");
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(editor.querySelector('[data-block-id="m0004"]')).toBeNull();

    // A DEEPER block is inserted into the segment (after the root, indent
    // 1): the insert touches no subtree root — only the projection's
    // re-derivation sees it (the segment grows without the nested editor
    // remounting).
    let childId = "";
    act(() => {
      childId = master.insertBlock("paragraph", { indent: 1 }, { parent: master.meta.id, after: "m0003" });
      master.insertText(childId, 0, "Master subtree child");
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(wrapper.textContent).toContain("Master subtree child");
    expect(editor.querySelector(`[data-block-id="${childId}"]`)).not.toBeNull();

    // A second deeper block after the child: the segment grows again.
    let grandchildId = "";
    act(() => {
      grandchildId = master.insertBlock("paragraph", { indent: 2 }, { parent: master.meta.id, after: childId });
    });
    expect(wrapper.textContent).toContain("Master subtree child");
    expect(editor.querySelector(`[data-block-id="${grandchildId}"]`)).not.toBeNull();

    // The removal shrinks the segment back to the root (the core
    // removeBlock cascades the derived segment — one call removes both):
    // the rows unmount, the subtree root's node still stands (no remount
    // across the grow/shrink cycle).
    act(() => {
      master.removeBlock(childId);
    });
    expect(wrapper.querySelector('[data-block-id="m0003"]')).toBe(firstM0003);
    expect(editor.querySelector(`[data-block-id="${childId}"]`)).toBeNull();
    expect(editor.querySelector(`[data-block-id="${grandchildId}"]`)).toBeNull();
    expect(wrapper.textContent).not.toContain("Master subtree child");
  });
});
