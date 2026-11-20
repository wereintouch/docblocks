// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { pressPointOf } from "./canvas-press";
import { type TestDoc, renderScene } from "./canvas-scene";

afterEach(cleanup);

describe("canvas: the connector's style attrs", () => {
  /** The styled scene: the two rects + the styled connector (the data
   * color / width / the circle heads on both sides) + the plain one
   * (the token stand). */
  function seedStyledScene(doc: TestDoc): void {
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
      doc.insertBlock(
        "connector",
        {
          start: { blockId: a },
          end: { blockId: b },
          strokeColor: "#ff0000",
          strokeWidth: 3,
          arrowHead: "circle",
          arrowStart: "circle",
        },
        { parent: surface }
      );
      // The waypoint bends the plain line off the styled one's (the
      // press's zone is per line — the coincident lines stand the
      // topmost's zone only).
      doc.insertBlock(
        "connector",
        { start: { blockId: a }, end: { blockId: b }, points: [[0, -40]] },
        { parent: surface }
      );
    });
  }

  it("the data color / width / the circle heads stand on the line (the per-fill defs)", () => {
    renderScene({ view: "canvas", seed: seedStyledScene });
    // The per-line stand: the two lines stand in their own SVGs (the
    // insertion order's DOM order).
    const lines = document.querySelectorAll<SVGPathElement>("[data-connector-id]");
    expect(lines.length).toBe(2);
    const styled = lines[0];
    const plain = lines[1];
    if (styled === undefined || plain === undefined) throw new Error("the lines are missing");

    // The data color (the style's stand — the presentation attribute
    // cannot carry it; the CSSOM serializes the hex to the rgb stand).
    expect(styled.style.stroke).toBe("rgb(255, 0, 0)");
    expect(plain.style.stroke).toBe("var(--docblocks-canvas-shape-stroke, currentColor)");
    // The width stand (3 / the 1 default).
    expect(styled.getAttribute("stroke-width")).toBe("3");
    expect(plain.getAttribute("stroke-width")).toBe("1");
    // The arrowheads: the circle's def on both sides (the hex's # is
    // dropped from the def id — the url fragment), the token line's end
    // arrow keeps the legacy def id, no start marker for it.
    expect(styled.getAttribute("marker-end")).toBe("url(#docblocks-conn-arrow-c0001-cff0000-ci)");
    expect(styled.getAttribute("marker-start")).toBe("url(#docblocks-conn-arrow-c0001-cff0000-ci)");
    expect(plain.getAttribute("marker-end")).toBe("url(#docblocks-conn-arrow-c0001)");
    expect(plain.getAttribute("marker-start")).toBeNull();
    // The per-fill defs stand.
    expect(document.getElementById("docblocks-conn-arrow-c0001-cff0000-ci")?.tagName.toLowerCase()).toBe("marker");
    expect(document.getElementById("docblocks-conn-arrow-c0001")?.tagName.toLowerCase()).toBe("marker");
  });

  it("the selected line stands the accent (the data color hides under the selection, the width's bump)", () => {
    const doc = renderScene({ view: "canvas", seed: seedStyledScene });
    const view = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    // The press over the styled line's band (the plain line's waypoint
    // keeps its line clear of the press's point).
    const surfaceId = doc.getChildren(doc.meta.id)[0]!;
    const styledId = doc.getChildren(surfaceId).find((id) => doc.getBlock(id)?.type === "connector")!;
    const p = pressPointOf(doc, styledId);
    fireEvent.pointerDown(view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    const line = document.querySelector<SVGPathElement>("[data-connector-id]")!;
    expect(line.getAttribute("data-selected")).toBe("true");
    expect(line.style.stroke).toBe("var(--docblocks-canvas-selected-stroke)");
    // The width's bump over the data stand (3 + 1).
    expect(line.getAttribute("stroke-width")).toBe("4");
    // The accent's arrowhead def (the circle stands on the accent fill).
    expect(line.getAttribute("marker-end")).toBe("url(#docblocks-conn-arrow-c0001-selected-ci)");
  });

  it("the arrowhead's none stand drops the markers (the line stands without the heads)", () => {
    renderScene({
      view: "canvas",
      seed: (d) => {
        const surface = d.insertBlock("surface");
        const a = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
        d.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
        const b = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
        d.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
        d.insertBlock(
          "connector",
          { start: { blockId: a }, end: { blockId: b }, arrowHead: "none" },
          { parent: surface }
        );
      },
    });
    const line = document.querySelector<SVGPathElement>("[data-connector-id]")!;
    expect(line.getAttribute("marker-end")).toBeNull();
    expect(line.getAttribute("marker-start")).toBeNull();
    // The line stands (the stroke is the token's).
    expect(line.style.stroke).toBe("var(--docblocks-canvas-shape-stroke, currentColor)");
  });

  it("the label's empty string is the removed stand (no text at the midpoint)", () => {
    renderScene({
      view: "canvas",
      seed: (d) => {
        const surface = d.insertBlock("surface");
        const a = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
        d.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
        const b = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
        d.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
        d.insertBlock("connector", { start: { blockId: a }, end: { blockId: b }, label: "" }, { parent: surface });
      },
    });
    // The line stands, the label's text stands nothing (the empty
    // commit's removed state).
    expect(document.querySelector("[data-connector-id]")).not.toBeNull();
    expect(document.querySelector("[data-connector-label]")).toBeNull();
  });
});
