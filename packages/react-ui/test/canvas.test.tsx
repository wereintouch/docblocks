// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import type { BlockRendererMap } from "../src/blocks/renderers";
import { EditorProvider } from "../src/editor-provider";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

/** Deterministic canvas ids: c0001 surface, then the elements in z-order. */
function canvasIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `c${String(next).padStart(4, "0")}`;
  };
}

const IDS = {
  surface: "c0001",
  rect: "c0002",
  ellipse: "c0003",
  text: "c0004",
  connector: "c0005",
  brokenConnector: "c0006",
  frame: "c0007",
  docIdConnector: "c0008",
  pointsConnector: "c0009",
} as const;

/**
 * The canvas scene (the ids follow the insertion order — the children
 * order IS the z-order): a rect, a dashed ellipse, a sized canvas-text,
 * a connector between the two shapes, a connector with an unresolvable
 * start, a childless frame (the viewport window — the content stands on
 * the surface, not on the frame), a connector with a docId ref
 * (skipped: cross-doc resolution is the consumer's level), and a
 * points connector (the polyline path).
 */
function seedCanvasScene(doc: TestDoc): void {
  doc.transact(() => {
    const surface = doc.insertBlock("surface");
    doc.setGeometry(surface, { x: 0, y: 0, w: 800, h: 400 });
    const rect = doc.insertBlock("shape", { variant: "rect", fill: "rgba(9, 105, 218, 0.2)" }, { parent: surface });
    doc.setGeometry(rect, { x: -100, y: -40, w: 120, h: 80 });
    const ellipse = doc.insertBlock("shape", { variant: "ellipse", strokeStyle: "dash" }, { parent: surface });
    doc.setGeometry(ellipse, { x: 120, y: 0, w: 60, h: 60 });
    const text = doc.insertBlock("canvas-text", { fontSize: 20, textAlign: "center" }, { parent: surface });
    doc.insertText(text, 0, "Canvas text");
    doc.setGeometry(text, { x: 0, y: 100, w: 140, h: 40 });
    doc.insertBlock(
      "connector",
      { start: { blockId: rect }, end: { blockId: ellipse }, label: "link" },
      { parent: surface }
    );
    doc.insertBlock(
      "connector",
      { start: { blockId: "absent-block" }, end: { blockId: ellipse } },
      { parent: surface }
    );
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(frame, { x: 300, y: -120, w: 260, h: 200 });
    doc.insertBlock(
      "connector",
      { start: { docId: "other-doc", blockId: rect }, end: { blockId: ellipse } },
      { parent: surface }
    );
    doc.insertBlock(
      "connector",
      {
        start: { blockId: rect },
        end: { blockId: ellipse },
        points: [
          [10, 10],
          [40, 20],
        ],
      },
      { parent: surface }
    );
  });
}

interface RenderOptions {
  blockRenderers?: BlockRendererMap;
  /** The doc seed (the canvas scene by default). */
  seed?: (doc: TestDoc) => void;
  /** The editor's view (page by default). */
  view?: "page" | "canvas";
}

function renderScene(options?: RenderOptions) {
  const doc = createDoc({ id: "outer", createdAt: CREATED_AT, generateId: canvasIdGenerator() });
  (options?.seed ?? seedCanvasScene)(doc);
  render(
    <EditorProvider doc={doc} blockRenderers={options?.blockRenderers}>
      <Editor view={options?.view} />
    </EditorProvider>
  );
  return doc;
}

/** The canvas-item wrappers over the world's DIRECT children (the z-order
 * pin — the frame's window's copies stand inside the frame's wrapper and
 * stand out of the list). */
function canvasItemIds(): string[] {
  const world = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]');
  if (world === null) return [];
  return Array.from(world.children)
    .filter((el): el is HTMLElement => el instanceof HTMLElement && el.dataset.slot === "docblocks/canvas-item")
    .map((el) => el.dataset.blockId as string);
}

/** A Y.Map-shaped instance (the borrowed-constructor seed below). */
interface YMapLike {
  set(key: string, value: unknown): void;
}

/**
 * A canvas element at the page root (the lenient-data case the registry
 * forbids — a foreign peer or a raw CRDT write). react-ui must not import
 * yjs, so the Y.Map constructor is borrowed from the doc's registered
 * meta map instance.
 */
function seedStrayShape(doc: TestDoc): void {
  const metaMap = doc.raw.getMap("meta") as unknown as { constructor: new () => YMapLike };
  const YMap = metaMap.constructor;
  const id = "stray-shape";
  const entry = new YMap();
  entry.set("type", "shape");
  const attrs = new YMap();
  attrs.set("variant", "rect");
  entry.set("attrs", attrs);
  doc.raw.transact(() => {
    doc.raw.getMap("blocks").set(id, entry);
    doc.raw.getArray("rootOrder").push([id]);
  });
}

afterEach(cleanup);

/** Parses the path's numeric coordinate pairs (the M/L/C sequence). */
function parsePathPoints(d: string): { x: number; y: number }[] {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (x === undefined || y === undefined) break;
    points.push({ x, y });
  }
  return points;
}

describe("canvas scene", () => {
  it("renders the surface container with the elements in z-order (DOM order)", () => {
    renderScene({ view: "canvas" });
    // The scene renders ONLY in the canvas view (the page view filters the
    // surface out of the sequence), so the container's stand is the
    // canvas-view's world.
    expect(document.querySelector('[data-slot="docblocks/canvas-world"]')).not.toBeNull();
    // The frame stands the view back (the window's parity — it renders
    // behind every other item; the z-order's data slot keeps its role for
    // the figures).
    expect(canvasItemIds()).toEqual([
      IDS.frame,
      IDS.rect,
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.docIdConnector,
      IDS.pointsConnector,
    ]);
  });

  it("reorders the elements on a moveBlock within the surface (the z-order change)", () => {
    const doc = renderScene({ view: "canvas" });
    // Move the rect (index 0) to the end of the surface's children
    // (pre-move index semantics: toIndex = the current last position + 1).
    act(() => {
      doc.moveBlock(IDS.rect, IDS.surface, 8);
    });
    // The frame's view-back stand: it stands first (behind the figures),
    // the figures' z-order within their run.
    expect(canvasItemIds()).toEqual([
      IDS.frame,
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.docIdConnector,
      IDS.pointsConnector,
      IDS.rect,
    ]);
  });

  it("positions the elements by geometry (the center-anchor coordinate model)", () => {
    renderScene({ view: "canvas" });
    const rect = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.rect}"]`
    )!;
    // The center-anchor model: the wrapper is placed at (center + x,
    // center + y) and centered over the point (jsdom normalizes the
    // negative offset inside the calc).
    expect(rect.style.left).toBe("calc(50% - 100px)");
    expect(rect.style.top).toBe("calc(50% - 40px)");
    expect(rect.style.width).toBe("120px");
    expect(rect.style.height).toBe("80px");
    expect(rect.style.transform).toBe("translate(-50%, -50%)");
  });

  it("renders the shapes as SVGs (the variant figures, the dash style, the fill attr)", () => {
    renderScene({ view: "canvas" });
    const rect = document.querySelector<SVGElement>(`[data-slot="docblocks/shape"][data-block-id="${IDS.rect}"]`)!;
    expect(rect.getAttribute("data-variant")).toBe("rect");
    expect(rect.querySelector("rect")).not.toBeNull();
    expect(rect.querySelector("ellipse")).toBeNull();
    // The fill attr is a data-driven presentation attribute.
    expect(rect.querySelector("g")!.getAttribute("fill")).toBe("rgba(9, 105, 218, 0.2)");

    const ellipse = document.querySelector<SVGElement>(
      `[data-slot="docblocks/shape"][data-block-id="${IDS.ellipse}"]`
    )!;
    expect(ellipse.querySelector("ellipse")).not.toBeNull();
    expect(ellipse.querySelector("g")!.getAttribute("stroke-dasharray")).toBe("8 4");
  });

  it("renders the canvas-text as an editable block with the font attrs as inline styles", () => {
    renderScene({ view: "canvas" });
    // The original's wrapper over the world's direct children (the frame's
    // window's copy stands inside the frame's wrapper — the z-order's
    // direct-children' stand).
    const world = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-world"]')!;
    const wrapper = world.querySelector<HTMLElement>(
      `:scope > [data-slot="docblocks/canvas-item"][data-block-id="${IDS.text}"]`
    )!;
    expect(wrapper.style.fontSize).toBe("20px");
    expect(wrapper.style.textAlign).toBe("center");
    // The text stands twice (the original + the frame's window's copy —
    // the inert's copy's stand). The inner's stand is the inert's rest
    // (the edit session's open over the double-click's entry stands the
    // editable — the press's contract: the single click stands the
    // selection, no caret).
    expect(screen.getAllByText("Canvas text").length).toBe(2);
    const editable = wrapper.querySelector<HTMLElement>(
      `[data-slot="docblocks/block-content"][data-block-id="${IDS.text}"]`
    )!;
    expect(editable.getAttribute("contenteditable")).toBe("false");
  });

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
    // The hit path (the wide transparent stroke the line clicks on).
    expect(document.querySelector(`[data-connector-hit="${IDS.connector}"]`)).not.toBeNull();

    // The label's chip (the HTML overlay — outside the SVG layer; the
    //: the chip stands always, not only in the
    // edit).
    const label = document.querySelector<HTMLElement>(`[data-connector-label="${IDS.connector}"]`)!;
    expect(label.textContent).toBe("link");

    // The broken connector: no line, the wrapper is marked.
    expect(document.querySelector(`[data-connector-id="${IDS.brokenConnector}"]`)).toBeNull();
    const broken = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.brokenConnector}"]`
    )!;
    expect(broken.getAttribute("data-missing")).toBe("true");

    // The docId-ref connector: the cross-doc ref is unresolvable within
    // the surface (v1) — skipped like the absent block, the wrapper marked.
    expect(document.querySelector(`[data-connector-id="${IDS.docIdConnector}"]`)).toBeNull();
    const docIdRef = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.docIdConnector}"]`
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
    renderScene({ view: "canvas" });
    // The click on the hit path selects the connector (no move session —
    // the connectors carry no geometry).
    const hit = document.querySelector<SVGPathElement>(`[data-connector-hit="${IDS.connector}"]`)!;
    fireEvent.pointerDown(hit, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
    const line = document.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(line.getAttribute("data-selected")).toBe("true");
    expect(line.style.stroke).toBe("var(--docblocks-canvas-selected-stroke)");
    expect(line.getAttribute("stroke-width")).toBe("2");
  });
});

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
      doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
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
    renderScene({ view: "canvas", seed: seedStyledScene });
    const hit = document.querySelector<SVGPathElement>("[data-connector-hit]")!;
    fireEvent.pointerDown(hit, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(hit, { pointerId: 1 });
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

describe("canvas: frame (the viewport window)", () => {
  it("renders the window (the border / the canvas background / the true clipping) and stands no nested content", () => {
    const doc = renderScene({ view: "canvas" });
    const frame = document.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${IDS.frame}"]`)!;
    expect(frame).not.toBeNull();
    const box = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-window']")!;
    // The true window: the content is clipped at the box.
    expect(box.className).toContain("overflow-hidden");
    expect(box.className).toContain("rounded-(--docblocks-radius)");
    // The canvas's own background: the color + the 24px dot grid (the
    // world grid's phase — the box at (300, -120) 260x200 stands the
    // top-left world corner at (170, -220): the phase 170 mod 24 = 2 →
    // the dot's half-step offset 12 - 2 = 10; -220's phase 20 →
    // 12 - 20 + 24 = 16).
    expect(box.style.backgroundColor).toBe("var(--docblocks-canvas-background)");
    expect(box.style.backgroundImage).toBe(
      "radial-gradient(circle, var(--docblocks-canvas-view-dot) 1px, transparent 1px)"
    );
    expect(box.style.backgroundSize).toBe("24px 24px");
    expect(box.style.backgroundPosition).toBe("10px 16px");
    // The container's thin rounded border: the 1px inset ring (the resting
    // stand over the canvas group's border token).
    expect(box.style.boxShadow).toBe("inset 0 0 0 1px var(--docblocks-canvas-group-border-color)");
    // The frame is childless: the content is the surface's window copy, not
    // the frame's children (the nested-page's stand is gone).
    expect(doc.getChildren(IDS.frame)).toEqual([]);
    expect(frame.querySelector("h1")).toBeNull();
    // The window's content stands the surface's items (the inert copy — the
    // rect stands inside the window, not as a direct surface's item twice:
    // the copy's wrapper stands inside the window's content's stand).
    const content = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-window-content']")!;
    expect(content).not.toBeNull();
    expect(content.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${IDS.rect}"]`)).not.toBeNull();
    // The frame's cycle guard: the frame does not stand inside its own
    // window.
    expect(content.querySelector(`[data-slot='docblocks/canvas-item'][data-block-id="${IDS.frame}"]`)).toBeNull();
  });

  it("stands the selection's outline over the window (the ring's switch to the selection's color)", () => {
    renderScene({ view: "canvas" });
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.frame}"]`
    )!;
    const box = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame-window']")!;
    expect(wrapper.hasAttribute("data-selected")).toBe(false);
    expect(box.style.outline).toBe("");
    // The press selects the frame (the window's content is pointer-
    // transparent — the press stands the frame's wrapper's generic item's
    // branch: select + the move session).
    fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(wrapper, { pointerId: 1 });
    expect(wrapper.getAttribute("data-selected")).toBe("true");
    // The ring stands the selection's color (the wrapper's outline stands
    // the shared selection's stand).
    expect(box.style.outline).toBe(
      "var(--docblocks-canvas-selection-border-width) solid var(--docblocks-canvas-selection-border-color)"
    );
    expect(box.style.boxShadow).toBe("inset 0 0 0 1px var(--docblocks-canvas-selection-border-color)");
  });

  it("stands the title chip (the chip's stand, the empty's removed stand)", () => {
    const doc = renderScene({ view: "canvas" });
    const frame = document.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${IDS.frame}"]`)!;
    expect(frame.querySelector("[data-slot='docblocks/frame-title']")).toBeNull(); // the absent's off
    act(() => {
      doc.updateBlock(IDS.frame, { title: "My frame" });
    });
    const chip = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-title']");
    expect(chip).not.toBeNull();
    expect(chip!.textContent).toBe("My frame");
    act(() => {
      doc.updateBlock(IDS.frame, { title: "" });
    });
    expect(frame.querySelector("[data-slot='docblocks/frame-title']")).toBeNull(); // the empty's off
  });

  it("enters the title's inline edit on the chip's double-click and commits on the blur (one updateBlock)", () => {
    const doc = renderScene({ view: "canvas" });
    act(() => {
      doc.updateBlock(IDS.frame, { title: "First" });
    });
    const chip = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/frame"][data-block-id="${IDS.frame}"] [data-slot='docblocks/frame-title']`
    )!;
    fireEvent.dblClick(chip);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-edit']")!;
    expect(edit).not.toBeNull();
    expect(edit.getAttribute("aria-label")).toBe("Frame title");
    expect((edit as HTMLInputElement).value).toBe("First");
    // The commit (the blur): one updateBlock over the frame's title.
    const editInput = edit as HTMLInputElement;
    editInput.value = "First — edited";
    fireEvent.blur(edit);
    const frame = doc.getBlock(IDS.frame);
    expect(frame?.type === "frame" && frame.attrs?.title).toBe("First — edited");
  });

  it("stands the set-title menu on the selection over the title-less frame (the commit's one updateBlock)", () => {
    const doc = renderScene({ view: "canvas" });
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.frame}"]`
    )!;
    const frame = wrapper.querySelector<HTMLElement>("[data-slot='docblocks/frame']")!;
    // The selection (the title-less stand): the menu's trigger stands at
    // the title's seat.
    fireEvent.pointerDown(wrapper, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(wrapper, { pointerId: 1 });
    const menu = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu']");
    expect(menu).not.toBeNull();
    expect(menu!.getAttribute("aria-label")).toBe("Set frame title");
    fireEvent.click(menu!);
    const input = frame.querySelector<HTMLElement>("[data-slot='docblocks/frame-title-menu-input']")!;
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: "Seated" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const block = doc.getBlock(IDS.frame);
    expect(block?.type === "frame" && block.attrs?.title).toBe("Seated");
    // The menu closes, the chip stands over the title's commit.
    expect(frame.querySelector("[data-slot='docblocks/frame-title']")!.textContent).toBe("Seated");
  });
});

describe("canvas: lenient render", () => {
  it("renders a stray shape at the page root as the placeholder (the unknown-kind posture)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "Outer paragraph");
      seedStrayShape(doc);
    });
    render(
      <EditorProvider doc={doc}>
        <Editor />
      </EditorProvider>
    );
    expect(document.querySelector('[data-slot="docblocks/placeholder"][data-block-type="shape"]')).not.toBeNull();
    expect(screen.getByText("Outer paragraph")).not.toBeNull();
  });

  it("keeps a shape without a geometry at the center with the default size", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );
    const wrapper = document.querySelector<HTMLElement>("[data-slot='docblocks/canvas-item']")!;
    expect(wrapper.style.left).toBe("calc(50% + 0px)");
    expect(wrapper.style.top).toBe("calc(50% + 0px)");
    expect(wrapper.style.width).toBe("100px");
    expect(wrapper.style.height).toBe("100px");
  });
});

describe("canvas: shape variants", () => {
  it("renders the diamond, the rounded rectangle, and the freehand points (the variant figures)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const diamond = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
      doc.setGeometry(diamond, { x: -100, y: 0, w: 80, h: 80 });
      const rounded = doc.insertBlock("shape", { variant: "rounded" }, { parent: surface });
      doc.setGeometry(rounded, { x: 0, y: 0, w: 100, h: 40 });
      const freehand = doc.insertBlock(
        "shape",
        {
          variant: "rect",
          points: [
            [0, 0],
            [10, 5],
            [20, 0],
          ],
        },
        { parent: surface }
      );
      doc.setGeometry(freehand, { x: 100, y: 0, w: 40, h: 40 });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );

    const diamond = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="diamond"]')!;
    // The 4-point polygon: the box midpoint corners (the 80x80 box, the stroke inset 1).
    expect(diamond.querySelector("polygon")!.getAttribute("points")).toBe("40,1 79,40 40,79 1,40");

    // The rounded rect: the rect with the corner radius (15% of the
    // smaller box side — the 100x40 box stands 6).
    const rounded = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="rounded"]')!;
    expect(rounded.querySelector("rect")!.getAttribute("rx")).toBe("6");

    // The freehand points win over the variant figure: a stroke path
    // through the block-local points.
    const freehand = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="rect"]')!;
    expect(freehand.querySelector("path")!.getAttribute("d")).toBe("M 0 0 L 10 5 L 20 0");
    expect(freehand.querySelector("rect")).toBeNull();
  });

  it("renders the cylinder and the cloud (the new figure variants)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const cylinder = doc.insertBlock("shape", { variant: "cylinder" }, { parent: surface });
      doc.setGeometry(cylinder, { x: 0, y: 0, w: 100, h: 120 });
      const cloud = doc.insertBlock("shape", { variant: "cloud" }, { parent: surface });
      doc.setGeometry(cloud, { x: 150, y: 0, w: 130, h: 95 });
    });
    render(
      <EditorProvider doc={doc}>
        <Editor view="canvas" />
      </EditorProvider>
    );

    // The cylinder (the 100x120 box, the stroke inset 1): the body path
    // with the elliptical end caps (the cap's half-height 15 — the
    // box-proportional stand) + the top cap's seam arc (the front half,
    // the figure's tell; the stroke only).
    const cylinder = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="cylinder"]')!;
    const paths = cylinder.querySelectorAll("path");
    expect(paths.length).toBe(2);
    expect(paths[0]!.getAttribute("d")).toBe("M 1 16 A 49 15 0 0 1 99 16 L 99 104 A 49 15 0 0 1 1 104 Z");
    expect(paths[1]!.getAttribute("d")).toBe("M 1 16 A 49 15 0 0 0 99 16");
    expect(paths[1]!.getAttribute("fill")).toBe("none");

    // The cloud (the 130x95 box): the mirrored outline (the silhouette
    // flipped over the vertical axisthe
    // box-proportional stand, the arc radii scale anisotropically, the
    // stroke width stands, the inverse sweep flags).
    const cloud = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="cloud"]')!;
    const cloudPath = cloud.querySelector("path")!;
    expect(cloudPath.getAttribute("d")).toBe(
      "M 27.256410256410255 94 H 83.05128205128204 A 45.94871794871795 40.6875 0 1 0 39.00615384615384 41.6875 H 27.256410256410255 A 29.538461538461537 26.15625 0 1 0 27.256410256410255 94 Z"
    );
  });
});

describe("canvas: consumer renderer", () => {
  it("wins over the built-in canvas renderers (shape and canvas-text)", () => {
    const renderers: BlockRendererMap = {
      shape: ({ id }) => <span data-custom="shape">{`custom-shape-${id}`}</span>,
      "canvas-text": ({ id }) => <span data-custom="canvas-text">{`custom-text-${id}`}</span>,
    };
    renderScene({ view: "canvas", blockRenderers: renderers });
    // The built-in shape SVGs are gone; the custom ones render in place.
    expect(document.querySelector("[data-slot='docblocks/shape']")).toBeNull();
    expect(document.querySelector("[data-custom='shape']")!.textContent).toBe(`custom-shape-${IDS.rect}`);
    expect(document.querySelector("[data-custom='canvas-text']")!.textContent).toBe(`custom-text-${IDS.text}`);
  });
});

/** The texted shape of the scene's JSON (the text-attr's stand). */
function textedShape(doc: TestDoc) {
  const block = Object.values(doc.toJSON().blocks).find((entry) => entry.type === "shape");
  return block?.type === "shape" ? block : null;
}

describe("canvas: the shape's text (the double-click's inline edit)", () => {
  function seedTextedShape(doc: TestDoc) {
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const rounded = doc.insertBlock(
        "shape",
        {
          variant: "rounded",
          text: "Привет\nмир",
          fontSize: 24,
          fontFamily: "Inter",
          textColor: "#ff0000",
          textStyle: "semibold-italic",
          textAlign: "left",
        },
        { parent: surface }
      );
      doc.setGeometry(rounded, { x: 0, y: 0, w: 160, h: 80 });
      const plain = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(plain, { x: 100, y: 100, w: 80, h: 40 });
    });
  }

  it("stands the text overlay with the font attrs as inline styles (the data, not theme)", () => {
    renderScene({ seed: seedTextedShape, view: "canvas" });
    const overlay = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text']")!;
    expect(overlay).not.toBeNull();
    expect(overlay.textContent).toBe("Привет\nмир");
    // The style stands the wrapper div (the flex centering box).
    const wrapper = overlay.parentElement!;
    const style = wrapper.style;
    expect(style.fontFamily).toBe('"Inter", "Open Sans", Arial, sans-serif');
    expect(style.fontSize).toBe("24px");
    expect(style.color).toBe("rgb(255, 0, 0)");
    expect(style.fontWeight).toBe("600");
    expect(style.fontStyle).toBe("italic");
    expect(style.textAlign).toBe("left");
    // The wrapping (the figure's edges) and the pre-wrap soft breaks.
    expect(style.whiteSpace).toBe("pre-wrap");
    expect(style.overflowWrap).toBe("break-word");
  });

  it("stands the defaults (the 16px, the center alignment, the editor's font) for the attrless stand", () => {
    renderScene({ seed: seedTextedShape, view: "canvas" });
    const plainItem = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/shape-text']");
    // The textless rect stands the empty overlay (the dblclick's target).
    expect(plainItem.length).toBe(2);
    const empty = [...plainItem].find((el) => el.textContent === "")!;
    const style = empty.parentElement!.style;
    expect(style.fontSize).toBe("16px");
    expect(style.textAlign).toBe("center");
    expect(style.fontFamily).toBe("");
  });

  it("enters the inline edit on the double-click and commits the text on the blur (one updateBlock)", () => {
    const doc = renderScene({ seed: seedTextedShape, view: "canvas" });
    // The dblclick's target is the full-size box (the inner's content div
    // is zero-height on the empty stand).
    const target = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-target']")!;
    fireEvent.dblClick(target);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-edit']")!;
    expect(edit).not.toBeNull();
    expect(edit.getAttribute("contenteditable")).toBe("true");
    // The seed stands the attr's text (the draft is the browser's).
    expect(edit.textContent).toBe("Привет\nмир");
    // The draft: the browser's edit (the test stands it directly).
    act(() => {
      edit.textContent = "Привет\nмир!\nдва";
    });
    fireEvent.blur(edit);
    expect(textedShape(doc)?.attrs?.text).toBe("Привет\nмир!\nдва");
    // One undo step.
    doc.undo();
    expect(textedShape(doc)?.attrs?.text).toBe("Привет\nмир");
  });

  it("commits nothing for the empty edit (the no-op stand writes no attr)", () => {
    const doc = renderScene({ seed: seedTextedShape, view: "canvas" });
    const items = document.querySelectorAll<HTMLElement>("[data-slot='docblocks/shape-text-target']");
    const empties = [...items];
    const before = doc.toJSON();
    fireEvent.dblClick(empties[empties.length - 1]!);
    const edit = document.querySelector<HTMLElement>("[data-slot='docblocks/shape-text-edit']")!;
    expect(edit.textContent).toBe("");
    fireEvent.blur(edit);
    expect(doc.toJSON()).toEqual(before);
  });
});
