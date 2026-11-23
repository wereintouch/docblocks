// @vitest-environment jsdom
// The line follows the moved / resized items mid-drag (the live
// geometry): the move / resize's preview stands the line (the anchor /
// the port follows the previewed edge), the release's commit stands the
// same geometry.
import { act, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderCanvas } from "./canvas-connector-preview.helpers";
import { pressPointOf } from "./canvas-press";

describe("the line follows the moved / resized items mid-drag (the live geometry)", () => {
  it("the move preview stands the line (the anchor follows the item; the release commit stands the same geometry)", () => {
    const r = renderCanvas();
    const surfaceId = Object.keys(r.doc.toJSON().blocks).find((id) => r.doc.getBlock(id)?.type === "surface");
    if (surfaceId === undefined) throw new Error("the surface is missing");
    act(() => {
      r.doc.insertBlock("connector", { start: { blockId: r.a }, end: { blockId: r.b } }, { parent: surfaceId });
    });
    const surfaceBlock = r.doc.getBlock(surfaceId);
    if (surfaceBlock === null || surfaceBlock.type !== "surface") throw new Error("the surface is missing");
    const connectorId = (surfaceBlock.children ?? []).find((id) => r.doc.getBlock(id)?.type === "connector");
    if (connectorId === undefined) throw new Error("the connector is missing");
    const lineD = () => r.view.querySelector<SVGPathElement>(`[data-connector-id="${connectorId}"]`)!.getAttribute("d");
    // The rest: a's east anchor (-50, 0), b's west anchor (50, 0).
    expect(lineD()).toBe("M -50 0 L 50 0");

    // The move session: the press on a's own zone (the resolver's answer —
    // clear of the line's band), the drag +20px right.
    const point = pressPointOf(r.doc, r.a);
    fireEvent.pointerDown(r.view, { button: 0, clientX: point.x, clientY: point.y, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: point.x + 20, clientY: point.y, buttons: 1, pointerId: 1 });
    // The live geometry: a's anchor stands at the PREVIEW position (-30, 0)
    // (b's anchor stands — a's center is 20px further away, but the west
    // edge stands in the same point for this axis-aligned pair).
    expect(lineD()).toBe("M -30 0 L 50 0");

    // The release commits the geometry; the line stands the same (the doc
    // and the preview stand from one number).
    fireEvent.pointerUp(r.view, { clientX: point.x + 20, clientY: point.y, pointerId: 1 });
    const moved = r.doc.getBlock(r.a);
    expect(moved?.geometry?.x).toBe(-80);
    expect(lineD()).toBe("M -30 0 L 50 0");
  });

  it("the resize preview stands the line (the port follows the resized edge)", () => {
    const r = renderCanvas();
    const surfaceId = Object.keys(r.doc.toJSON().blocks).find((id) => r.doc.getBlock(id)?.type === "surface");
    if (surfaceId === undefined) throw new Error("the surface is missing");
    act(() => {
      r.doc.insertBlock(
        "connector",
        { start: { blockId: r.a, port: "east" }, end: { blockId: r.b, port: "west" } },
        { parent: surfaceId }
      );
    });
    const surfaceBlock = r.doc.getBlock(surfaceId);
    if (surfaceBlock === null || surfaceBlock.type !== "surface") throw new Error("the surface is missing");
    const connectorId = (surfaceBlock.children ?? []).find((id) => r.doc.getBlock(id)?.type === "connector");
    if (connectorId === undefined) throw new Error("the connector is missing");
    const lineD = () => r.view.querySelector<SVGPathElement>(`[data-connector-id="${connectorId}"]`)!.getAttribute("d");
    // The rest: a's east port (-50, 0), b's west port (50, 0).
    expect(lineD()).toBe("M -50 0 L 50 0");

    // The resize session: the press on a's own zone (the resolver's
    // answer — clear of the line's band) selects it (the sub-threshold
    // click commits no move); the east handle stands. The drag grows a to
    // the east: the east port moves with the previewed edge.
    const point = pressPointOf(r.doc, r.a);
    fireEvent.pointerDown(r.view, { button: 0, clientX: point.x, clientY: point.y, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: point.x, clientY: point.y, pointerId: 1 });
    const handle = r.view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-handle"][data-handle="e"]`);
    if (handle === null) throw new Error("the resize handle is missing");
    fireEvent.pointerDown(handle, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -40, clientY: 0, buttons: 1, pointerId: 1 });
    // The port stands at the previewed east edge (the center -100 + 60 —
    // the w 100 → 120 grew the east edge from -50 to -40).
    expect(lineD()).toBe("M -40 0 L 50 0");
    fireEvent.pointerUp(r.view, { clientX: -40, clientY: 0, pointerId: 1 });
    // The release commits the previewed box (w 100 → 110: the east edge
    // stood at -40, the center at -100).
    const resized = r.doc.getBlock(r.a);
    expect(resized?.geometry?.w).toBe(110);
    expect(lineD()).toBe("M -40 0 L 50 0");
  });
});
