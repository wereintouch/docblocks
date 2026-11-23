// @vitest-environment jsdom
// The cross-drag's mousedown's stands over the click's counts: the
// single-click's default's suppression (the editor stands the seat), the
// multi-click's session's teardown (the native word/paragraph select
// stands), and the triple press's whole-block select (the synthetic-input's
// path, the default line select's suppression).
import { describe, expect, it } from "vitest";

import {
  domSelection,
  innerOf,
  mouseDown,
  pointerDown,
  pointerMove,
  pointerUp,
  renderDoc,
  stubCaret,
} from "./cross-drag.helpers";

describe("the cross-drag selection session", () => {
  it("suppresses the single-click mousedown default action (the editor stands the seat)", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    caret.seatIn(a, 2);
    pointerDown(innerOf(a));
    const single = mouseDown(innerOf(a), 1);
    expect(single.defaultPrevented).toBe(true);
    pointerUp();
    const after = domSelection()!;
    expect(after.collapsed).toBe(true);
    expect(after.start).toEqual([a, 2]);
  });

  it("tears down the session on a multi-click press (the native word/paragraph select stands)", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    // The session stands on the synthetic pointerdown (its detail stands
    // 0); the multi-click's mousedown carries the real count: the session
    // is torn down and the press's default action stands (the browser's
    // native word/paragraph select is the selection writer).
    caret.seatIn(a, 2);
    pointerDown(innerOf(a));
    const before = domSelection();
    const multi = mouseDown(innerOf(a), 2);
    expect(multi.defaultPrevented).toBe(false);

    // The session is gone: the moves and the release seat nothing — the
    // selection stands exactly as it stood before the press (the editor
    // wrote nothing on the multi-click's own press).
    caret.seatIn(a, 4);
    pointerMove();
    pointerUp();
    expect(domSelection()).toEqual(before);
  });

  it("stands the whole-block selection on a triple press with the session active (the synthetic-input path)", () => {
    const { a } = renderDoc();
    const caret = stubCaret();

    // The synthetic pointer stands detail 0: the session stands on the
    // triple press's own pointerdown; the press's mousedown (detail 3)
    // stands the editor's whole-block select and tears the session down —
    // the moves and the release behind it seat nothing.
    caret.seatIn(a, 2);
    pointerDown(innerOf(a));
    const triple = mouseDown(innerOf(a), 3);
    expect(triple.defaultPrevented).toBe(true);
    const during = domSelection()!;
    expect(during.collapsed).toBe(false);
    expect(during.start).toEqual([a, 0]);
    expect(during.end).toEqual([a, 5]);
    caret.seatIn(a, 4);
    pointerMove();
    pointerUp();
    expect(domSelection()).toEqual(during);
  });

  it("stands the whole-block selection on a triple press (the default line select is suppressed)", () => {
    const { a } = renderDoc();

    // The triple press stands the editor's whole-block select: the native
    // line select of a pre-wrap block is suppressed, the selection stands
    // over the block's whole text (the permanent handler, session or not).
    const triple = mouseDown(innerOf(a), 3);
    expect(triple.defaultPrevented).toBe(true);
    const after = domSelection()!;
    expect(after.collapsed).toBe(false);
    expect(after.start).toEqual([a, 0]);
    expect(after.end).toEqual([a, 5]);
  });
});
