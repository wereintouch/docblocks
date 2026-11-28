// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { domSelection, innerOf, pointerDown, pointerMove, pointerUp, renderDoc, stubCaret } from "./cross-drag.helpers";

describe("the cross-drag selection session", () => {
  it("seats a cross-block selection from the pointer moves and keeps it over the pointerup", () => {
    const { a, b } = renderDoc();
    const caret = stubCaret();

    // Anchor at block a's end, drag into block b.
    caret.seatIn(a, 5);
    pointerDown(innerOf(a));
    caret.seatIn(b, 3);
    pointerMove();

    const during = domSelection()!;
    expect(during.collapsed).toBe(false);
    // The from/to stand in document order (block a first, block b last).
    const [startBlock, startOffset] = during.start;
    const [endBlock, endOffset] = during.end;
    expect([startBlock, startOffset]).toEqual([a, 5]);
    expect([endBlock, endOffset]).toEqual([b, 3]);

    // The release keeps the selection (the browser's own seat is
    // suppressed for the session's pointer).
    pointerUp();
    const after = domSelection()!;
    expect(after.collapsed).toBe(false);
    expect(after.start).toEqual([a, 5]);
    expect(after.end).toEqual([b, 3]);
  });

  it("seats the caret at the anchor on a click without a drag", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    caret.seatIn(a, 2);
    pointerDown(innerOf(a));
    pointerUp();

    const after = domSelection()!;
    expect(after.collapsed).toBe(true);
    expect(after.start).toEqual([a, 2]);
  });

  it("seats a reverse cross selection forward when the anchor stands at offset 0", () => {
    const { a, b } = renderDoc();
    const caret = stubCaret();

    // Anchor at block a's head (offset 0), drag back into... block b stands
    // after a, so the reverse case is anchored at b's head dragging to a:
    caret.seatIn(b, 0);
    pointerDown(innerOf(b));
    caret.seatIn(a, 1);
    pointerMove();

    const during = domSelection()!;
    expect(during.collapsed).toBe(false);
    // The degenerate reverse case is seated forward: the base stands at
    // the earlier endpoint (block a), the focus at the anchor (block b).
    expect(during.start[0]).toBe(a);
    expect(during.start[1]).toBe(1);
    expect(during.end[0]).toBe(b);
    expect(during.end[1]).toBe(0);
    pointerUp();
  });

  it("ignores the pointerdown outside a text inner (no session, no seat)", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    // A pointerdown on the block wrapper (the marker gutter area): no
    // session stands, and the moves seat nothing.
    const wrapper = document.querySelector<HTMLElement>(`[data-block-id="${a}"]:not([data-slot="docblocks/row"])`)!;
    window.getSelection()?.removeAllRanges();
    caret.seatIn(a, 0);
    pointerDown(wrapper);
    pointerMove();
    expect(domSelection()).toBeNull();

    pointerUp();
    caret.clear();
    // No session is active any more: a second drag is possible (an
    // in-block range this time: the anchor at the head, the pointer two
    // characters in).
    caret.seatIn(a, 0);
    pointerDown(innerOf(a));
    caret.seatIn(a, 2);
    pointerMove();
    const second = domSelection()!;
    expect(second.collapsed).toBe(false);
    expect(second.start).toEqual([a, 0]);
    expect(second.end).toEqual([a, 2]);
    pointerUp();
  });
});
