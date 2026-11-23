// @vitest-environment jsdom
// The canvas mouse selection (the shift-click additive toggle, the
// shift-marquee union, the Escape clear, and the multi-selection's summary
// box).
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { dragTo, pressPointOf } from "./canvas-press";
import { click, renderCanvas, selectedIds, shiftClick } from "./canvas-selection.helpers";

describe("the shift-click toggle", () => {
  it("adds the id to the standing selection (no move, the doc stands)", () => {
    const r = renderCanvas();
    const before = JSON.stringify(r.json());
    click(r, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);

    shiftClick(r, r.b);
    expect(selectedIds(r.view)).toEqual([r.a, r.b]);
    expect(JSON.stringify(r.json())).toBe(before); // no update (a no-op move would stand the same)
    // The no-preview pin: the wrapper's transform stands its own (no move preview).
    expect(r.wrapperOf(r.b).style.transform).toBe("translate(-50%, -50%)");
  });

  it("removes the id from the selection (the anchor follows)", () => {
    const r = renderCanvas();
    click(r, r.a);
    shiftClick(r, r.b); // the anchor is b (the clicked id joins)
    expect(selectedIds(r.view).sort()).toEqual([r.a, r.b].sort());

    shiftClick(r, r.b); // the toggle removes b; the anchor falls back to a
    expect(selectedIds(r.view)).toEqual([r.a]);

    shiftClick(r, r.a); // the last id's removal stands no selection
    expect(selectedIds(r.view)).toEqual([]);
  });

  it("stands alone from an empty selection", () => {
    const r = renderCanvas();
    shiftClick(r, r.b);
    expect(selectedIds(r.view)).toEqual([r.b]);
  });

  it("toggles the connector over the line's band (the wrapper stands no outline)", () => {
    const r = renderCanvas();
    const line = r.view.querySelector<SVGPathElement>(`[data-connector-id="${r.connector}"]`)!;
    shiftClick(r, r.connector);
    expect(line.getAttribute("data-selected")).toBe("true");

    // The connector's wrapper: no tint, no outline (the line's stroke is
    // its emphasis).
    const wrapper = r.wrapperOf(r.connector);
    expect(wrapper.classList.contains("bg-(--docblocks-selected-background)")).toBe(false);
    expect(wrapper.className).toBe("");

    // The toggle back: the line stands deselected.
    shiftClick(r, r.connector);
    expect(line.getAttribute("data-selected")).toBe(null);
  });
});

describe("the shift-marquee union", () => {
  it("unions the marquee's ids with the standing selection", () => {
    const r = renderCanvas();
    click(r, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);

    // The additive marquee (the shift down on the empty canvas): the start
    // stands clear of every block's press zone, and the rect crosses the
    // origin (jsdom stands the wrappers 0x0 there), so it picks up both —
    // the union adds b.
    fireEvent.pointerDown(r.view, { clientX: -40, clientY: -30, shiftKey: true, pointerId: 2 });
    fireEvent.pointerMove(r.view, { clientX: 60, clientY: 40, buttons: 1, pointerId: 2 });
    fireEvent.pointerUp(r.view, { pointerId: 2 });
    // The union: a (the pre-marquee) + b (the marquee's pick).
    expect(selectedIds(r.view).sort()).toEqual([r.a, r.b].sort());
  });

  it("keeps the selection on the sub-3px additive press (no clear)", () => {
    const r = renderCanvas();
    click(r, r.a);

    // The shift press without a drag: the selection STANDS (the plain
    // press would clear it).
    const start = r.view.getBoundingClientRect();
    fireEvent.pointerDown(r.view, {
      clientX: start.x + start.width - 5,
      clientY: start.y + 5,
      shiftKey: true,
      pointerId: 3,
    });
    fireEvent.pointerUp(r.view, { pointerId: 3 });
    expect(selectedIds(r.view)).toEqual([r.a]);
  });
});

describe("the Escape clear", () => {
  it("clears the standing selection (nothing is written)", () => {
    const r = renderCanvas();
    click(r, r.a);
    const before = JSON.stringify(r.json());
    // The Escape clear stands on the editor root's blocks-selection path
    // (the page contract — the container's handler only intercepts the
    // tool / the in-flight session cancels, which stand first).
    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(selectedIds(r.view)).toEqual([]);
    expect(JSON.stringify(r.json())).toBe(before);
  });

  it("does not clear while a move preview is in flight (the cancel stands first)", () => {
    const r = renderCanvas();
    const wrapper = r.wrapperOf(r.a);
    const point = pressPointOf(r.doc, r.a);
    fireEvent.pointerDown(r.view, { button: 0, clientX: point.x, clientY: point.y, pointerId: 5 });
    dragTo(r.view, { x: point.x + 40, y: point.y }, 5); // the preview stands
    expect(wrapper.style.transform).toContain("translate(40px, 0px)");

    // The Escape drops the preview; the selection STANDS.
    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(wrapper.style.transform).toBe("translate(-50%, -50%)");
    expect(selectedIds(r.view)).toEqual([r.a]);
    // The release after the cancel writes nothing (the no-op contract).
    fireEvent.pointerUp(r.view, { pointerId: 5 });
    expect(r.doc.getBlock(r.a)?.geometry).toEqual({ x: -100, y: -50, w: 100, h: 60 });
  });

  it("stands the selection over a shift press on the page card (no root move, no clear)", () => {
    const r = renderCanvas();
    click(r, r.a);
    expect(selectedIds(r.view)).toEqual([r.a]);
    const card = r.view.querySelector<HTMLElement>("[data-slot='docblocks/page-card']");
    expect(card).not.toBeNull();
    const before = JSON.stringify(r.json());
    // The card's shift press clear of the canvas items (the line crosses
    // the canvas's center): the press stands the selection, no root move.
    fireEvent.pointerDown(card!, { button: 0, shiftKey: true, clientX: 300, clientY: 300, pointerId: 9 });
    // The selection stands (the card's shift press starts no move).
    expect(selectedIds(r.view)).toEqual([r.a]);
    expect(JSON.stringify(r.json())).toBe(before);
  });

  it("keeps the base selection over an additive marquee that sweeps nothing", () => {
    const r = renderCanvas();
    click(r, r.a);
    const before = JSON.stringify(r.json());
    // The shift-marquee stands off every item (the 0x0 jsdom boxes stand
    // at the origin) — the empty union keeps the base selection.
    fireEvent.pointerDown(r.view, { button: 0, shiftKey: true, clientX: 500, clientY: 500, pointerId: 8 });
    fireEvent.pointerMove(r.view, { clientX: 600, clientY: 560, buttons: 1, pointerId: 8 });
    fireEvent.pointerUp(r.view, { pointerId: 8 });
    expect(selectedIds(r.view)).toEqual([r.a]);
    expect(JSON.stringify(r.json())).toBe(before);
  });
});

describe("the multi-selection's summary box", () => {
  it("stands the union box over two selected items (the token's line + fill + offset)", () => {
    const r = renderCanvas();
    click(r, r.a);
    shiftClick(r, r.b);
    const box = r.view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-multi-selection']");
    expect(box).not.toBeNull();
    expect(box!.className).toContain("border-(--docblocks-canvas-selection-border-color)");
    expect(box!.className).toContain("border-(length:--docblocks-canvas-selection-border-width)");
    expect(box!.className).toContain("bg-(--docblocks-canvas-selection-fill)");
    // The offset is the CSS token (the style's calc reads it — no px
    // literal for the breath).
    expect(box!.style.left).toContain("var(--docblocks-canvas-selection-box-offset)");
    expect(box!.style.width).toContain("2 * var(--docblocks-canvas-selection-box-offset)");
  });

  it("stands no box for a single selection (the item's outline stands)", () => {
    const r = renderCanvas();
    click(r, r.a);
    expect(r.view.querySelector("[data-slot='docblocks/canvas-multi-selection']")).toBeNull();
  });

  it("stands no box over a selection with a connector only (no own geometry)", () => {
    const r = renderCanvas();
    // The shift-click on the connector's wrapper toggles the id (the
    // wrapper's press stands the toggle — the hit path is the e2e's
    // path). The selection is a + connector: the only box-carrying
    // member is one — no union.
    click(r, r.a);
    shiftClick(r, r.connector);
    expect(selectedIds(r.view)).toEqual([r.a, r.connector]);
    expect(r.view.querySelector("[data-slot='docblocks/canvas-multi-selection']")).toBeNull();
  });

  it("stands no box while a move preview is in flight (the union is stale)", () => {
    const r = renderCanvas();
    click(r, r.a);
    shiftClick(r, r.b);
    expect(r.view.querySelector("[data-slot='docblocks/canvas-multi-selection']")).not.toBeNull();
    // The group drag (the preview stands): the box stands down.
    const point = pressPointOf(r.doc, r.a);
    fireEvent.pointerDown(r.view, { button: 0, clientX: point.x, clientY: point.y, pointerId: 21 });
    dragTo(r.view, { x: point.x + 50, y: point.y }, 21);
    expect(r.view.querySelector("[data-slot='docblocks/canvas-multi-selection']")).toBeNull();
    fireEvent.pointerUp(r.view, { pointerId: 21 });
  });
});

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);
