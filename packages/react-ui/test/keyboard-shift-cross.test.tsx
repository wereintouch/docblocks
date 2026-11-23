// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId, Selection } from "docblocks-core";

import { caretAtFlat, context, key, renderDoc, wrapperOf } from "./keyboard.helpers";

describe("shift+arrow over the cross range: the vertical's cross (the collapse's no-stand)", () => {
  let p1: BlockId;
  let p2: BlockId;
  let p3: BlockId;
  const renderThree = () =>
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one line");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two line");
      p3 = d.insertBlock("paragraph");
      d.insertText(p3, 0, "three lin");
    });

  it("shift+up chains over the blocks (the second's press stands the extension, not the collapse)", () => {
    renderThree();
    caretAtFlat(p3, 0);
    // Press 1: the block handler's cross edge's stand (the previous block's end).
    expect(key(wrapperOf(p3), { key: "ArrowUp", shiftKey: true })).toBe(false);
    // Press 2: the focus stands at p2's end (the single-line's block) — the
    // chain's continuation's stand (the adjacent block's cross).
    expect(key(wrapperOf(p2), { key: "ArrowUp", shiftKey: true })).toBe(false);
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 8 },
      to: { blockId: p3, offset: 0 },
      blocks: [p1, p2, p3],
      reverse: true,
    } as Selection);
  });

  it("shift+down chains over the blocks (the single-line's cross from any offset)", () => {
    renderThree();
    caretAtFlat(p1, 8); // the end (the caret's down cross's edge's stand)
    expect(key(wrapperOf(p1), { key: "ArrowDown", shiftKey: true })).toBe(false);
    expect(key(wrapperOf(p2), { key: "ArrowDown", shiftKey: true })).toBe(false);
    const view = context!.selection.view!;
    expect(view.get()).toEqual({
      kind: "text",
      from: { blockId: p1, offset: 8 },
      to: { blockId: p3, offset: 0 },
      blocks: [p1, p2, p3],
    } as Selection);
  });

  it("the document's edge stand the suppressed no-op (the no-adjacent-block's stand, the collapse's no-stand)", () => {
    renderThree();
    // The cross range to the last block's end: the caret at p2's end, shift+down
    // → p3's start, the horizontal's end → p3's end (the range's edge).
    caretAtFlat(p2, 8);
    expect(key(wrapperOf(p2), { key: "ArrowDown", shiftKey: true })).toBe(false);
    expect(key(wrapperOf(p3), { key: "End", shiftKey: true })).toBe(false);
    // The vertical over the last block (the no-adjacent-block's stand):
    // the range stands (no collapse, no move).
    const before = context!.selection.view!.get();
    expect(before).toEqual({
      kind: "text",
      from: { blockId: p2, offset: 8 },
      to: { blockId: p3, offset: 9 },
      blocks: [p2, p3],
    } as Selection);
    expect(key(wrapperOf(p3), { key: "ArrowDown", shiftKey: true })).toBe(false);
    expect(context!.selection.view!.get()).toEqual(before);
    // The up's cross to the previous block's end — over the anchor's own
    // position (the p2's end): the range's shrink to the caret's stand
    // (the selection's shrink's parity over the editor's cross's model).
    expect(key(wrapperOf(p3), { key: "ArrowUp", shiftKey: true })).toBe(false);
    const after = context!.selection.view!.get();
    expect(after).toEqual({
      kind: "text",
      from: { blockId: p2, offset: 8 },
      to: null,
      blocks: [p2],
    } as Selection);
  });

  it("the multi-line's inner line stands the native's in-block's walk (the passthrough)", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "first\nsecond line"); // 17 chars, the two soft-break lines' stand
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "next line");
    });
    // The cross range's construction: the caret at p2's start, shift+up →
    // p1's end (the block handler's cross edge's stand), the horizontal's
    // back-step to p1's second line's middle (the line's 2's stand — not
    // the block's edge).
    caretAtFlat(p2, 0);
    expect(key(wrapperOf(p2), { key: "ArrowUp", shiftKey: true })).toBe(false);
    for (let i = 0; i < 7; i++) expect(key(wrapperOf(p1), { key: "ArrowLeft", shiftKey: true })).toBe(false);
    // The vertical over the multi-line's inner line: the passthrough's
    // stand (the native's in-block's line's walk, no suppression).
    const result = key(wrapperOf(p1), { key: "ArrowUp", shiftKey: true });
    expect(result).toBe(true);
  });
});
