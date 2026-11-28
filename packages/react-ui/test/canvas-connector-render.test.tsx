// @vitest-environment jsdom
import { cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { pressPointOf } from "./canvas-press";
import { IDS, type TestDoc, parsePathPoints, renderScene } from "./canvas-scene";

afterEach(cleanup);

describe("canvas scene: the connectors", () => {
  it("renders the connector line between the resolved EDGES and skips the broken one (data-missing)", () => {
    renderScene({ view: "canvas" });
    // The per-line stand (the explicit zIndex's paint order):
    // each connector's line stands in its own SVG (the wrapper's content),
    // so the line is queried by its data hook, document-wide.
    const line = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(line.tagName.toLowerCase()).toBe("path");
    // The edge anchors: the rect (-100, -40, 120x80) -> the ellipse
    // (120, 0, 60x60): the direction (220, 40) exits the rect's east edge
    // at (-40, -40 + 40 * 60/220) and enters the ellipse's west edge at
    // (90, -40 * 30/220).
    const points = parsePathPoints(line.getAttribute("d")!);
    expect(points.length).toBe(2);
    const from = points[0];
    const to = points[1];
    if (from === undefined || to === undefined) throw new Error("the path is malformed");
    expect(from.x).toBeCloseTo(-40);
    expect(from.y).toBeCloseTo(-40 + 40 * (60 / 220));
    expect(to.x).toBeCloseTo(90);
    expect(to.y).toBeCloseTo(-40 * (30 / 220));
    // The arrowhead marker (the per-surface def — the hidden defs svg the
    // per-line svg references by the url fragment).
    expect(line.getAttribute("marker-end")).toBe("url(#docblocks-conn-arrow-c0001)");
    expect(document.querySelector('[data-slot="docblocks/connector-defs"] marker')).not.toBeNull();
    // The hit path (the wide transparent stroke over the line's band —
    // the press's zone reads the line's geometry).
    expect(document.querySelector(`[data-connector-hit="${IDS.connector}"]`)).not.toBeNull();

    // The label's chip (the HTML overlay — outside the SVG layer; the
    //: the chip stands always, not only in the
    // edit).
    const label = document.querySelector<HTMLElement>(`[data-connector-label="${IDS.connector}"]`)!;
    expect(label.textContent).toBe("link");

    // The broken connector: no line, the wrapper is marked.
    expect(document.querySelector(`[data-connector-id="${IDS.brokenConnector}"]`)).toBeNull();
    const broken = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.brokenConnector}"]:not([data-slot="docblocks/row"])`
    )!;
    expect(broken.getAttribute("data-missing")).toBe("true");

    // The docId-ref connector: the cross-doc ref is unresolvable within
    // the surface (v1) — skipped like the absent block, the wrapper marked.
    expect(document.querySelector(`[data-connector-id="${IDS.docIdConnector}"]`)).toBeNull();
    const docIdRef = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.docIdConnector}"]:not([data-slot="docblocks/row"])`
    )!;
    expect(docIdRef.getAttribute("data-missing")).toBe("true");

    // The points connector: a single path from the start edge anchor
    // through the waypoints to the end edge anchor (the points keep the
    // priority over the variant — the absent variant's straight shape).
    const polyline = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.pointsConnector}"]`)!;
    const polyPoints = parsePathPoints(polyline.getAttribute("d")!);
    expect(polyPoints.length).toBe(4);
    const [p0, p1, p2, p3] = polyPoints;
    if (p0 === undefined || p1 === undefined || p2 === undefined || p3 === undefined) {
      throw new Error("the path is malformed");
    }
    // The waypoints stand as stored; the endpoints are the centers (the
    // pre-variant points behavior stands as-is — the variant math applies
    // to the points-less connectors only).
    expect(p0).toEqual({ x: -100, y: -40 });
    expect(p1).toEqual({ x: 10, y: 10 });
    expect(p2).toEqual({ x: 40, y: 20 });
    expect(p3).toEqual({ x: 120, y: 0 });
  });

  it("renders the connector's stroke style (the data-driven dasharray: dash / dot / the solid default)", () => {
    const doc = renderScene({
      view: "canvas",
      seed: (d: TestDoc) => {
        d.transact(() => {
          const surface = d.insertBlock("surface");
          const a = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
          d.setGeometry(a, { x: -100, y: 0, w: 80, h: 60 });
          const b = d.insertBlock("shape", { variant: "rect" }, { parent: surface });
          d.setGeometry(b, { x: 100, y: 0, w: 80, h: 60 });
          d.insertBlock(
            "connector",
            { start: { blockId: a }, end: { blockId: b }, strokeStyle: "dash" },
            { parent: surface }
          );
          d.insertBlock(
            "connector",
            { start: { blockId: a }, end: { blockId: b }, strokeStyle: "dot" },
            { parent: surface }
          );
          d.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
        });
      },
    });
    const json = doc.toJSON();
    const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]?.type === "surface")!;
    // The per-line stand: each path is queried by its data hook,
    // document-wide (the per-line svg's content).
    // The connectors stand in the insertion order (the dash, the dot, the solid default).
    const connIds = doc.getChildren(surfaceId).filter((id) => doc.getBlock(id)?.type === "connector");
    const styleOf = (id: string): string | undefined => {
      const block = doc.getBlock(id);
      return block !== null && block.type === "connector" ? block.attrs?.strokeStyle : undefined;
    };
    const dashConn = connIds.find((id) => styleOf(id) === "dash")!;
    const dotConn = connIds.find((id) => styleOf(id) === "dot")!;
    const solidConn = connIds.find((id) => styleOf(id) === undefined)!;
    const dashPath = document.querySelector<SVGPathElement>(`[data-connector-id="${dashConn}"]`)!;
    expect(dashPath.getAttribute("stroke-dasharray")).toBe("8 4");
    const dotPath = document.querySelector<SVGPathElement>(`[data-connector-id="${dotConn}"]`)!;
    expect(dotPath.getAttribute("stroke-dasharray")).toBe("1 4");
    // The dot's round linecap (the dots' stand).
    expect(dotPath.getAttribute("stroke-linecap")).toBe("round");
    const solidPath = document.querySelector<SVGPathElement>(`[data-connector-id="${solidConn}"]`)!;
    expect(solidPath.getAttribute("stroke-dasharray")).toBeNull();
    expect(solidPath.getAttribute("stroke-linecap")).toBeNull();
  });

  it("renders the variant shapes (the orthogonal elbow and the curved bow)", () => {
    const doc = renderScene({ view: "canvas" });

    // The absent variant stands straight (the default).
    const straight = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(straight.getAttribute("d")!.startsWith("M ")).toBe(true);
    expect(straight.getAttribute("d")!.includes("C ")).toBe(false);

    act(() => {
      doc.updateBlock(IDS.connector, { variant: "orthogonal" });
    });
    // The horizontal-dominant elbow: out of the east mid-edge (-40, -40),
    // the vertical bend at the mid x ((-40 + 90)/2 = 25), into the west
    // mid-edge (90, 0).
    const orthogonal = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(orthogonal.getAttribute("d")).toBe("M -40 -40 L 25 -40 L 25 0 L 90 0");

    act(() => {
      doc.updateBlock(IDS.connector, { variant: "curved" });
    });
    // The curved: the cubic bezier (the control points ride the anchored
    // edges' outward normals — the east and the west).
    const curved = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(curved.getAttribute("d")!.includes(" C ")).toBe(true);
    const curvedPoints = parsePathPoints(curved.getAttribute("d")!);
    expect(curvedPoints.length).toBe(4);
  });

  it("stands the selected stroke on the selected connector", () => {
    const doc = renderScene({ view: "canvas" });
    const view = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    // The press over the line's band selects the connector (no move
    // session — the connectors carry no geometry).
    const p = pressPointOf(doc, IDS.connector);
    fireEvent.pointerDown(view, { button: 0, clientX: p.x, clientY: p.y, pointerId: 1 });
    fireEvent.pointerUp(view, { pointerId: 1 });
    const line = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(line.getAttribute("data-selected")).toBe("true");
    expect(line.style.stroke).toBe("var(--docblocks-canvas-selected-stroke)");
    expect(line.getAttribute("stroke-width")).toBe("2");
  });
});
