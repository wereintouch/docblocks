// @vitest-environment jsdom
// The connector's pending preview: after the first endpoint pick a solid
// cyan line stands from the pending block's edge anchor to the cursor (the
// hover update runs before the buttons guard — the button-less hover
// follows too), the press-drag's release over the second item stands the
// pick (the creation), and the completion / cancel drop the preview. The
// previews' svgs stand 1x1 (a 0x0 svg rasterizes no content in Chromium).
import { fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { connectorsOf, renderCanvas } from "./canvas-connector-preview.helpers";

describe("the connector's pending preview", () => {
  it("the first pick stands the preview (the solid line on the cyan token, the 1x1 svg)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });

    const line = r.previewLine();
    expect(line).not.toBeNull();
    const svg = line!.ownerSVGElement!;
    expect(svg.getAttribute("width")).toBe("1");
    expect(svg.getAttribute("height")).toBe("1");
    expect(line!.getAttribute("stroke")).toBe("var(--docblocks-canvas-selection-border-color)");
    // The pending new line has no stroke style: it stands the solid default
    // (per the data) — no dash pattern, the cyan color is the preview's stand.
    expect(line!.getAttribute("stroke-dasharray")).toBeNull();
    // The anchor stands on the pending block's edge (the box's border),
    // the far end is the cursor point (the jsdom bbox is 0 — the canvas
    // point is the client point as-is).
    const x1 = Number(line!.getAttribute("x1"));
    const y1 = Number(line!.getAttribute("y1"));
    expect(Math.abs(Math.abs(x1) - 50) <= 0.01 || Math.abs(Math.abs(y1) - 30) <= 0.01).toBe(true);
    expect(line!.getAttribute("x2")).toBe("-50");
    expect(line!.getAttribute("y2")).toBe("0");
  });

  it("the preview follows the button-less hover (the two-click path)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: -50, clientY: 0, pointerId: 1 });

    // The hover move (no button) re-feeds the preview point.
    fireEvent.pointerMove(r.view, { clientX: 40, clientY: -90, pointerId: 1 });
    const line = r.previewLine();
    expect(line).not.toBeNull();
    expect(line!.getAttribute("x2")).toBe("40");
    expect(line!.getAttribute("y2")).toBe("-90");

    // The second click completes: the connector lands, the preview drops.
    fireEvent.pointerDown(r.view, { clientX: 50, clientY: 0, button: 0, buttons: 1, pointerId: 2 });
    expect(connectorsOf(r.doc)).toHaveLength(1);
    expect(r.previewLine()).toBeNull();
  });

  it("the press-drag draw: the release over the second item stands the pick (the edge snaps at the press / release points)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // The press stands on a's east edge (the jsdom bbox is 0 — the canvas
    // point is the client point as-is; the surface stands at the origin),
    // the release on b's west edge: both snap to the edge's point at the
    // cursor's projection (the t = 0.5 midpoint stand — the continuous
    // anchor).
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: -40, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 50, clientY: 0, buttons: 1, pointerId: 1 });
    expect(r.previewLine()).not.toBeNull();

    fireEvent.pointerUp(r.view, { clientX: 50, clientY: 0, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { blockId: r.a, port: "east", portT: 0.5 },
      end: { blockId: r.b, port: "west", portT: 0.5 },
      zIndex: 3,
    });
    expect(r.previewLine()).toBeNull();
  });

  it("the press-drag draw: the release on the empty canvas commits the free end (the free point ref)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // A real drag from a to the empty canvas (well past the threshold):
    // the end commits as a free point at the release (surface-local —
    // the surface stands at the origin, the jsdom points stand as-is).
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: -40, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 300, clientY: 80, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { blockId: r.a, port: "east", portT: 0.5 },
      end: { x: 300, y: 80 },
      zIndex: 3,
    });
  });

  it("the empty-canvas press stands the free stand (the press point is the first endpoint)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);

    // The press off the items stands the free stand (the preview line
    // stands from the press point — not a block's edge anchor).
    fireEvent.pointerDown(r.view, { clientX: -200, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    const line = r.previewLine();
    expect(line).not.toBeNull();
    expect(line!.getAttribute("x1")).toBe("-200");
    expect(line!.getAttribute("y1")).toBe("100");

    // The release over b commits: the free start + the block end (the
    // release point (50, 0) snaps b's west edge at the midpoint's t).
    fireEvent.pointerMove(r.view, { clientX: 0, clientY: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(r.view, { clientX: 50, clientY: 0, pointerId: 1 });
    const connectors = connectorsOf(r.doc);
    expect(connectors).toHaveLength(1);
    expect(connectors[0]?.attrs).toEqual({
      start: { x: -200, y: 100 },
      end: { blockId: r.b, port: "west", portT: 0.5 },
      zIndex: 3,
    });
  });

  it("the Escape cancel drops the preview (the doc stands)", () => {
    const r = renderCanvas();
    const before = r.doc.toJSON();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="connector"]')!);
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 0, button: 0, buttons: 1, pointerId: 1 });
    expect(r.previewLine()).not.toBeNull();

    fireEvent.keyDown(r.view, { key: "Escape" });
    expect(r.previewLine()).toBeNull();
    expect(connectorsOf(r.doc)).toHaveLength(0);
    expect(r.doc.toJSON()).toEqual(before);
  });
});

describe("the previews' svgs stand 1x1 (the 0x0 rasterization)", () => {
  it("the pen preview's svg stands 1x1 (the in-flight stroke)", () => {
    const r = renderCanvas();
    fireEvent.click(r.view.querySelector<HTMLElement>('[data-tool="pen"]')!);
    // The pen's session stands on the empty canvas' press (the items
    // cancel the tool).
    fireEvent.pointerDown(r.view, { clientX: -50, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -30, clientY: 90, buttons: 1, pointerId: 1 });
    fireEvent.pointerMove(r.view, { clientX: -10, clientY: 80, buttons: 1, pointerId: 1 });
    const svg = r.view.querySelector<SVGElement>('[data-slot="docblocks/canvas-pen-preview"]');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute("width")).toBe("1");
    expect(svg!.getAttribute("height")).toBe("1");
  });
});
