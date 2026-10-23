// @vitest-environment jsdom
// The canvas fit: the fit's zoom / pan
// math over the content's union box (the center at the viewport's center,
// the smallest fitting zoom, the 25%–400% clamp, the degenerate no-op),
// the content's union (the page miniature + the surface items + the
// connector's free points; the empty canvas stands the no-op stand), and
// the chrome's button order (the fit stands the row's first).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";

import { ZoomControls } from "../src/blocks/canvas-view/ZoomControls";
import { canvasContentBox, fitView } from "../src/canvas/fit";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

describe("fitView", () => {
  it("centers the content at the smallest zoom that fits both axes", () => {
    // The content 400x200 at (100, 50) over the 800x400 viewport: the
    // ratio stands 2 on both axes; the pan stands -zoom * center.
    const stand = fitView({ x: 100, y: 50, w: 400, h: 200 }, { width: 800, height: 400 });
    expect(stand).toEqual({ zoom: 2, pan: { x: -200, y: -100 } });
  });

  it("stands the constrained axis (the smaller ratio decides)", () => {
    // The 800x100 content over the 800x400 viewport: the width stands 1,
    // the height stands 4 — the fit stands 1 (the content's width fills
    // the viewport's width).
    expect(fitView({ x: 0, y: 0, w: 800, h: 100 }, { width: 800, height: 400 })?.zoom).toBe(1);
    // The 100x400 content: the height stands 1 over the width's 8.
    expect(fitView({ x: 0, y: 0, w: 100, h: 400 }, { width: 800, height: 400 })?.zoom).toBe(1);
  });

  it("clamps at the 25% floor and the 400% ceiling", () => {
    // The 16000x8000 content: the raw ratio 0.05 stands the floor.
    expect(fitView({ x: 0, y: 0, w: 16000, h: 8000 }, { width: 800, height: 400 })?.zoom).toBe(0.25);
    // The 10x10 content: the raw ratio 80 stands the ceiling.
    expect(fitView({ x: 0, y: 0, w: 10, h: 10 }, { width: 800, height: 400 })?.zoom).toBe(4);
    // The clamp keeps the center's stand (the pan follows the clamped zoom).
    const stand = fitView({ x: 100, y: 50, w: 10, h: 10 }, { width: 800, height: 400 });
    expect(stand?.pan).toEqual({ x: -400, y: -200 });
  });

  it("stands the no-op over a degenerate box or viewport", () => {
    expect(fitView({ x: 0, y: 0, w: 0, h: 100 }, { width: 800, height: 400 })).toBeNull();
    expect(fitView({ x: 0, y: 0, w: 100, h: 0 }, { width: 800, height: 400 })).toBeNull();
    expect(fitView({ x: 0, y: 0, w: 100, h: 100 }, { width: 0, height: 400 })).toBeNull();
  });
});

describe("canvasContentBox", () => {
  it("unions the page miniature, the surface items, and the free points", () => {
    const doc = createDoc({ id: "fit-doc", createdAt: CREATED_AT });
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: 600, y: -400, w: 100, h: 80 });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    doc.setGeometry(b, { x: -500, y: 300, w: 60, h: 40 });
    // The geometry-less item stands the default box (the origin's center).
    doc.insertBlock("canvas-text", undefined, { parent: surface });
    // The connector's free point stands the union's point (the block-ref
    // endpoint stands the referenced item's box — no own contribution).
    doc.insertBlock("connector", { start: { blockId: a }, end: { x: -900, y: 0 } }, { parent: surface });

    const box = canvasContentBox(doc);
    // The miniature stands the default page box (720x960 at the origin).
    // The union: x over [-900, 650], y over [-480, 480].
    expect(box).toEqual({ x: -125, y: 0, w: 1550, h: 960 });
  });

  it("stands the no-op stand over the empty canvas", () => {
    // The page-only doc (no surface): the miniature alone is not content.
    const doc = createDoc({ id: "fit-empty", createdAt: CREATED_AT });
    expect(canvasContentBox(doc)).toBeNull();

    // The surface without items: the no-op stand as well.
    const withSurface = createDoc({ id: "fit-surface", createdAt: CREATED_AT });
    withSurface.insertBlock("surface");
    expect(canvasContentBox(withSurface)).toBeNull();
  });
});

describe("the zoom controls' button order", () => {
  afterEach(cleanup);

  it("stands the fit button to the left of the zoom-out button", () => {
    const noop = () => undefined;
    render(<ZoomControls zoom={1} onStep={noop} onReset={noop} onFit={noop} />);
    const toolbar = screen.getByRole("toolbar", { name: "Canvas zoom" });
    const labels = Array.from(toolbar.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["Fit to screen", "Zoom out", "Reset zoom", "Zoom in"]);
  });
});
