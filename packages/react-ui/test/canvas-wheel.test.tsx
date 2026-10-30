// @vitest-environment jsdom
// The wheel's gesture: the pointer mode
// pans the canvas (the 1:1 screen px, zoom-blind, the content stands
// OPPOSITE to the wheel's delta — the inversion; the shift stands
// the horizontal axis; the two-axis trackpad swipe stands both), the hand
// mode and the active tools keep the step zoom at the cursor (the 25%
// grid's step, the threshold accumulation), and the pinch (ctrl/cmd)
// zooms everywhere — the CONTINUOUS stand (the zoom scales by the delta —
// the smooth reaction, the trackpad's pinch). The pan and the zoom are
// pure view state — the doc stands.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { wheelGesture, wheelPanDeltas } from "../src/blocks/canvas-view/utils";
import { pinchZoom } from "../src/canvas/viewport";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "wheel-doc", createdAt: CREATED_AT });
}

function seededDoc(): { doc: TestDoc; shape: string } {
  const doc = newDoc();
  const surface = doc.insertBlock("surface");
  const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
  doc.setGeometry(shape, { x: 0, y: 0, w: 200, h: 100 });
  return { doc, shape };
}

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

function renderCanvas(doc: TestDoc) {
  const utils = render(
    <EditorProvider doc={doc}>
      <Editor view="canvas" />
    </EditorProvider>
  );
  const view = utils.container.querySelector('[data-slot="docblocks/canvas-view"]');
  if (view === null) throw new Error("the canvas view is missing");
  return { ...utils, view: view as HTMLElement };
}

/** The world wrapper's transform (the pan + the zoom's carrier). */
function worldTransform(view: HTMLElement): string {
  const world = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
  if (world === null) throw new Error("the world wrapper is missing");
  return world.style.transform;
}

describe("the wheel's gesture decision (the pure stand)", () => {
  it("the pointer mode pans (no tool, no pinch)", () => {
    expect(wheelGesture("default", null, { ctrlKey: false, metaKey: false, shiftKey: false })).toBe("pan");
    // The shift stands the horizontal axis — still the pan.
    expect(wheelGesture("default", null, { ctrlKey: false, metaKey: false, shiftKey: true })).toBe("pan");
  });

  it("the hand mode zooms (the shift stands the horizontal pan)", () => {
    expect(wheelGesture("pan", null, { ctrlKey: false, metaKey: false, shiftKey: false })).toBe("zoom");
    expect(wheelGesture("pan", null, { ctrlKey: false, metaKey: false, shiftKey: true })).toBe("pan");
  });

  it("the active tool zooms (both modes)", () => {
    for (const tool of ["rect", "cloud", "text", "frame", "connector", "pen"] as const) {
      expect(wheelGesture("default", tool, { ctrlKey: false, metaKey: false, shiftKey: false }), tool).toBe("zoom");
    }
    expect(wheelGesture("pan", "rect", { ctrlKey: false, metaKey: false, shiftKey: false })).toBe("zoom");
  });

  it("the pinch (ctrl / cmd) zooms everywhere", () => {
    expect(wheelGesture("default", null, { ctrlKey: true, metaKey: false, shiftKey: false })).toBe("zoom");
    expect(wheelGesture("default", null, { ctrlKey: false, metaKey: true, shiftKey: false })).toBe("zoom");
  });
});

describe("the wheel-pan's axis deltas (the 1:1 screen-px stand, the inversion)", () => {
  it("stands both axes opposite to the wheel's delta (the two-axis trackpad swipe)", () => {
    expect(wheelPanDeltas(40, 120, false)).toEqual({ dx: -40, dy: -120 });
    // The wheel down stands the canvas up (the inversion).
    expect(wheelPanDeltas(0, -120, false)).toEqual({ dx: 0, dy: 120 });
  });

  it("stands the horizontal axis only under the shift (inverted)", () => {
    // The browser's mapped shifted wheel (the deltaY stood on deltaX).
    expect(wheelPanDeltas(100, 0, true)).toEqual({ dx: -100, dy: 0 });
    // The unconverted notch (the deltaY fallback).
    expect(wheelPanDeltas(0, -100, true)).toEqual({ dx: 100, dy: 0 });
  });
});

describe("the pinch's continuous zoom (the pure stand)", () => {
  it("scales the zoom by the exponential of the delta (the smooth stand)", () => {
    expect(pinchZoom(1, -100)).toBeCloseTo(1.6487, 4);
    expect(pinchZoom(1, 100)).toBeCloseTo(0.6065, 4);
    // The small pinch event stands the proportional step (the reaction
    // without the threshold's lag).
    expect(pinchZoom(1, -10)).toBeCloseTo(1.0513, 4);
    // The zero delta stands the no-op.
    expect(pinchZoom(1, 0)).toBe(1);
  });

  it("clamps at the 25%–400% bounds (the past-bound delta stands the no-op)", () => {
    expect(pinchZoom(0.25, 9000)).toBe(0.25);
    expect(pinchZoom(4, -9000)).toBe(4);
    // A pinch from a mid value clamps at the bound (the value stands the
    // bound, not past it).
    expect(pinchZoom(0.3, 500)).toBe(0.25);
  });
});

describe("the wheel over the canvas view", () => {
  it("the pointer mode pans 1:1 in screen px, opposite to the delta (the zoom and the doc stand)", () => {
    const { doc } = seededDoc();
    const { view } = renderCanvas(doc);
    const before = JSON.stringify(doc.toJSON());
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1)");

    // The vertical notch: the content stands 1:1 BEHIND the delta's
    // direction (the inversion — the wheel down stands the canvas up).
    fireEvent.wheel(view, { deltaY: 120 });
    expect(worldTransform(view)).toBe("translate(0px, -120px) scale(1)");

    // The deltas accumulate (the pan is not thresholded).
    fireEvent.wheel(view, { deltaY: -80 });
    expect(worldTransform(view)).toBe("translate(0px, -40px) scale(1)");

    // The two-axis trackpad swipe: both axes.
    fireEvent.wheel(view, { deltaX: 60, deltaY: 30 });
    expect(worldTransform(view)).toBe("translate(-60px, -70px) scale(1)");

    // The doc stands (the pan is the view state).
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });

  it("the shift stands the horizontal pan only (the deltaY fallback, the mapped deltaX)", () => {
    const { view } = renderCanvas(seededDoc().doc);

    // The unconverted notch: the deltaY stands the horizontal delta.
    fireEvent.wheel(view, { deltaY: 100, shiftKey: true });
    expect(worldTransform(view)).toBe("translate(-100px, 0px) scale(1)");

    // The browser's mapped shifted wheel (the deltaY stood on deltaX).
    fireEvent.wheel(view, { deltaX: 120, deltaY: 40, shiftKey: true });
    expect(worldTransform(view)).toBe("translate(-220px, 0px) scale(1)");
  });

  it("the pan is zoom-blind (the same screen delta at a non-100% zoom)", () => {
    const { view } = renderCanvas(seededDoc().doc);
    // Step the zoom (the hand mode's wheel stand — the test below pins
    // the gesture; the step keeps the cursor's point fixed at the
    // container's center, the pan stands).
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    fireEvent.wheel(view, { deltaY: -120 });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.1)");

    // Back to the pointer mode: the same delta stands the same screen
    // shift (the zoom-blind 1:1 stand, inverted).
    fireEvent.click(screen.getByLabelText("Switch to the select mode"));
    fireEvent.wheel(view, { deltaY: 120 });
    expect(worldTransform(view)).toBe("translate(0px, -120px) scale(1.1)");
  });

  it("the pinch (ctrl+wheel) zooms continuously (the smooth stand, no step threshold)", () => {
    const { view } = renderCanvas(seededDoc().doc);
    // The small pinch event (the trackpad's delta): the zoom scales by
    // the exponential — not the step's jump.
    fireEvent.wheel(view, { deltaY: -50, ctrlKey: true });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.284)");
    // The second event accumulates proportionally (the smooth reaction —
    // the zoom scales from the rounded stand: 1.284 * exp(0.25)).
    fireEvent.wheel(view, { deltaY: -50, ctrlKey: true });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.6487)");
  });

  it("the hand mode zooms at the cursor (the old stand)", () => {
    const { view } = renderCanvas(seededDoc().doc);
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    fireEvent.wheel(view, { deltaY: -120 });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.1)");
    // The second notch: the threshold crossed again.
    fireEvent.wheel(view, { deltaY: -120 });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.2)");
  });

  it("the active tool zooms (the tool's stand over the pointer mode's pan)", () => {
    const { view } = renderCanvas(seededDoc().doc);
    // The dock's shapes' menu: the rect's pick stands the active tool.
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    fireEvent.wheel(view, { deltaY: -120 });
    expect(worldTransform(view)).toBe("translate(0px, 0px) scale(1.1)");
  });

  it("the pan commits nothing to the doc (the geometry stands)", () => {
    const { doc, shape } = seededDoc();
    const { view } = renderCanvas(doc);
    fireEvent.wheel(view, { deltaY: 500 });
    fireEvent.wheel(view, { deltaX: 200 });
    const block = doc.getBlock(shape);
    expect(block?.type === "shape" ? block.geometry : null).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it("consumes the wheel on every path (preventDefault — the page / the container never scrolls, the zero-delta no-op included)", () => {
    // The canvas view's wheel is always the viewport's transform (view
    // state), so every path — the pan, the zoom, and the zero-delta no-op —
    // preventDefaults (the non-passive listener) to keep the wheel from
    // chaining onto the page's scroll (the overlay scrollbar's flash).
    const { view } = renderCanvas(seededDoc().doc);
    const prevented = (init: WheelEventInit): boolean => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
      view.dispatchEvent(event);
      return event.defaultPrevented;
    };
    // The pan (the pointer mode's vertical notch).
    expect(prevented({ deltaY: 120 })).toBe(true);
    // The zero-delta no-op in the pointer mode: the pan's branch — the
    // formerly-leaking path (it must still not chain to the page's scroll).
    expect(prevented({ deltaX: 0, deltaY: 0 })).toBe(true);
    // The zoom (the pinch / ctrl+wheel).
    expect(prevented({ deltaY: -120, ctrlKey: true })).toBe(true);
    // The zoom (the hand mode's step) — the threshold's stand preventDefaults.
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(prevented({ deltaY: -120 })).toBe(true);
  });
});
