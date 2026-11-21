// @vitest-environment jsdom
// The canvas-text's entry: the ghost text block (the double-click's
// empty-canvas entry) + the press contract (the shape's parity — the
// single press selects + moves, the dblclick's caret).
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { validateDoc } from "docblocks-core";

import { TOOL_SIZES } from "../src/canvas/viewport";
import { dragTo, pressBlock, pressPointOf } from "./canvas-press";
import { canvasTextChildren, renderCanvas, textOf } from "./canvas-text.helpers";

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
});

describe("the ghost text block (the double-click's empty-canvas entry)", () => {
  it("stands the focused ghost on the empty canvas's dblclick (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    // The dblclick over the empty canvas (the view's own surface — no
    // item under the point): the ghost stands at the point with the
    // caret. jsdom's elementFromPoint stands null — the event's target
    // (the view) is the point's stand.
    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });

    const ghost = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost"]');
    expect(ghost).not.toBeNull();
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    expect(ghostInner).not.toBeNull();
    expect(ghostInner!.getAttribute("contenteditable")).toBe("true");
    // The caret stands at the ghost's start (the autofocus).
    expect(document.activeElement).toBe(ghostInner);
    // Nothing is written until the first input (the ghost is view state).
    expect(r.doc.toJSON()).toEqual(before);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("commits the first input in one transact (the insert + geometry + the text; the caret reseats)", async () => {
    const r = renderCanvas("seed");

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    act(() => {
      ghostInner.textContent = "Hello canvas";
      fireEvent.input(ghostInner);
    });

    // The ghost closes and the real block stands (the surface's child).
    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    const children = canvasTextChildren(r.doc, r.surface);
    expect(children.length).toBe(2); // the seed + the committed
    const committed = children.find((id) => id !== r.text);
    if (committed === undefined) throw new Error("the committed block is missing");
    expect(textOf(r.doc, committed)).toBe("Hello canvas");
    // The geometry: the default box's center over the top-left's point
    // (TOOL_SIZES.text's 200x40 — the point's (100, 80) stand the
    // top-left, the center's (200, 100)).
    const block = r.doc.getBlock(committed);
    if (block === null || block.type !== "canvas-text") throw new Error("the committed block is malformed");
    expect(block.geometry).toEqual({
      x: 100 + TOOL_SIZES.text.w / 2,
      y: 80 + TOOL_SIZES.text.h / 2,
      w: TOOL_SIZES.text.w,
      h: TOOL_SIZES.text.h,
    });
    // The caret reseats into the real block's inner (the frame flush —
    // the focusCaretIn's after-frame stand).
    const committedInner = r.view.querySelector<HTMLElement>(
      `[data-slot="docblocks/block-content"][data-block-id="${committed}"]`
    );
    expect(committedInner).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(document.activeElement).toBe(committedInner);
    // One undo step: the whole commit is a single transact (the caret's
    // reseat is the DOM-only stand — the doc stands the block).
    r.doc.undo();
    expect(r.doc.getBlock(committed)).toBeNull();
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the Escape cancels the ghost (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    fireEvent.keyDown(ghostInner, { key: "Escape" });

    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    expect(r.doc.toJSON()).toEqual(before);
    expect(canvasTextChildren(r.doc, r.surface).length).toBe(1); // the seed stands
  });

  it("the blur without input cancels the ghost (nothing is written)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    fireEvent.doubleClick(r.view, { clientX: 100, clientY: 80 });
    const ghostInner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    if (ghostInner === null) throw new Error("the ghost is missing");

    fireEvent.blur(ghostInner);

    expect(document.querySelector('[data-slot="docblocks/canvas-text-ghost"]')).toBeNull();
    expect(r.doc.toJSON()).toEqual(before);
  });
});

describe("the press contract (the shape's parity — the single press selects + moves, the dblclick's caret)", () => {
  it("the first press selects the block (the outline stands; the doc stands)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();

    pressBlock(r.view, r.doc, r.text);

    expect(r.item().hasAttribute("data-selected")).toBe(true);
    expect(r.doc.toJSON()).toEqual(before);
  });

  it("the first press's drag moves the block (one transact, one undo)", () => {
    const r = renderCanvas("seed");
    const before = r.doc.toJSON();
    const geometryBefore = before.blocks[r.text]?.geometry;

    const p = pressPointOf(r.doc, r.text);
    fireEvent.pointerDown(r.view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    dragTo(r.view, { x: p.x + 50, y: p.y + 30 }, 1);
    fireEvent.pointerUp(r.view, { pointerId: 1 });

    // The geometry lands at the screen delta (zoom 1, pan 0): the +50/+30.
    expect(r.doc.getBlock(r.text)?.geometry).toEqual({
      x: (geometryBefore?.x ?? 0) + 50,
      y: (geometryBefore?.y ?? 0) + 30,
      w: 100,
      h: 40,
    });
    r.doc.undo();
    expect(r.doc.getBlock(r.text)?.geometry).toEqual(geometryBefore);
    expect(validateDoc(r.doc.toJSON())).toEqual([]);
  });

  it("the second press (the block already selected) starts the move session (the drag's parity)", () => {
    const r = renderCanvas("seed");
    const geometryBefore = r.doc.getBlock(r.text)?.geometry;

    // The first press selects the block.
    pressBlock(r.view, r.doc, r.text);
    expect(r.item().hasAttribute("data-selected")).toBe(true);

    // The second press: the same press's stand (the block's selection +
    // the move session — the shape's parity, the drag moves it).
    const p = pressPointOf(r.doc, r.text);
    fireEvent.pointerDown(r.view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 2 });
    dragTo(r.view, { x: p.x + 60, y: p.y + 40 }, 2);
    fireEvent.pointerUp(r.view, { pointerId: 2 });

    expect(r.doc.getBlock(r.text)?.geometry).toEqual({
      x: (geometryBefore?.x ?? 0) + 60,
      y: (geometryBefore?.y ?? 0) + 40,
      w: geometryBefore?.w,
      h: geometryBefore?.h,
    });
  });

  it("the shift press toggles the block's selection (the item's parity)", () => {
    const r = renderCanvas("seed");

    // The shift press selects the block.
    pressBlock(r.view, r.doc, r.text, { shiftKey: true });
    expect(r.item().hasAttribute("data-selected")).toBe(true);

    // The shift press over the selected block deselects it.
    pressBlock(r.view, r.doc, r.text, { shiftKey: true });
    expect(r.item().hasAttribute("data-selected")).toBe(false);
  });
});
