// @vitest-environment jsdom
// The cross-block's text's range: the keyboard's operations (the
// Delete's / the Backspace's remove, the typing's replace, the whole's
// block's remove, the Enter's / the Tab's no-op) and the format's
// toolbar (the mark's apply over the per-block's segments, the code's
// chain's hide).
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import {
  childrenOf,
  flushFrames,
  key,
  renderDoc,
  selectAcross,
  textNodeOf,
  wrapperOf,
} from "./cross-selection.helpers";

describe("cross-block text range: the keyboard operations", () => {
  it("Delete removes the range as text: the endpoints are trimmed, the blocks survive", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    // p1 "alpha" (from offset 2) -> p2 "beta" (to offset 1): "lpha" + "b".
    selectAcross(p1, 2, p2, 1);
    const suppressed = key(wrapperOf(p1), "Delete");

    expect(suppressed).toBe(false);
    expect(doc.getText(p1)).toBe("al");
    expect(doc.getText(p2)).toBe("eta");
    expect(childrenOf(doc)).toEqual([p1, p2]);
  });

  it("Backspace removes the cross range the same way", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 2, p2, 1);
    const suppressed = key(wrapperOf(p2), "Backspace");

    expect(suppressed).toBe(false);
    expect(doc.getText(p1)).toBe("al");
    expect(doc.getText(p2)).toBe("eta");
  });

  it("typing replaces the range with the character; one mod+z restores it", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 2, p2, 1);
    const suppressed = key(wrapperOf(p1), "Z");

    expect(suppressed).toBe(false);
    expect(doc.getText(p1)).toBe("alZ");
    expect(doc.getText(p2)).toBe("eta");

    const undone = key(wrapperOf(p1), "z", { metaKey: true });
    expect(undone).toBe(false);
    expect(doc.getText(p1)).toBe("alpha");
    expect(doc.getText(p2)).toBe("beta");
  });

  it("a range covering whole blocks removes them entirely", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    let p3: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "gamma");
    });

    // The whole of p1, p2, and p3: both endpoints fully consumed.
    selectAcross(p1, 0, p3, 5);
    const suppressed = key(wrapperOf(p1), "Delete");

    expect(suppressed).toBe(false);
    expect(childrenOf(doc)).toEqual([]);
  });

  it("Enter is a no-op on a cross range (no split)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 1, p2, 1);
    const suppressed = key(wrapperOf(p1), "Enter");

    expect(suppressed).toBe(false);
    expect(childrenOf(doc)).toEqual([p1, p2]);
    expect(doc.getText(p1)).toBe("alpha");
    expect(doc.getText(p2)).toBe("beta");
  });

  it("Tab over a cross range is a no-op (consumed, the anchor is not re-parented)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    // The right-to-left case: the anchor in p2, whose previous sibling (p1)
    // is an eligible container — the block gesture would nest p2 under p1
    // without the no-op.
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.setBaseAndExtent(textNodeOf(p2), 0, textNodeOf(p1), 5);
    document.dispatchEvent(new Event("selectionchange"));
    const suppressed = key(wrapperOf(p2), "Tab");

    expect(suppressed).toBe(false); // consumed: the gesture must not re-parent
    expect(childrenOf(doc)).toEqual([p1, p2]);
    expect(doc.getText(p1)).toBe("alpha");
    expect(doc.getText(p2)).toBe("beta");
  });
});

describe("cross-block text range: the format toolbar", () => {
  /** Click a button by its data attribute (the toolbar buttons are in the editor root). */
  function click(selector: string): void {
    const button = document.querySelector<HTMLElement>(selector);
    expect(button, `the ${selector} button should be rendered`).not.toBeNull();
    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  it("applies a mark over the range's per-block segments", async () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "beta");
    });

    selectAcross(p1, 2, p2, 1);
    await flushFrames();
    expect(document.querySelector('[data-slot="docblocks/format-toolbar"]')).not.toBeNull();

    click('[data-slot="docblocks/format-toolbar"] [data-mark="bold"]');

    // The from block's tail and the to block's head are marked; the rest is not.
    expect(doc.getRuns(p1)).toEqual([
      { text: "al", marks: {} },
      { text: "pha", marks: { bold: true } },
    ]);
    expect(doc.getRuns(p2)).toEqual([
      { text: "b", marks: { bold: true } },
      { text: "eta", marks: {} },
    ]);

    // One undo step undoes the whole range mark.
    const undone = key(wrapperOf(p1), "z", { metaKey: true });
    expect(undone).toBe(false);
    expect(doc.getText(p1)).toBe("alpha");
    expect(doc.getText(p2)).toBe("beta");
  });

  it("hides when the chain carries a code block (the mark actions would have no target)", async () => {
    let p1: BlockId = "";
    let code: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "alpha");
      code = d.insertBlock("code");
      d.insertText(code, 0, "x = 1");
    });

    selectAcross(p1, 2, code, 3);
    await flushFrames();
    expect(document.querySelector('[data-slot="docblocks/format-toolbar"]')).toBeNull();
  });
});
