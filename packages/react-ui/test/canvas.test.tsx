// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { act } from "react";

import { createDoc } from "docblocks-core";

import { Editor } from "../src/Editor";
import { EditorProvider } from "../src/EditorProvider";
import type { BlockRendererMap } from "../src/blocks/renderers";

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
  frameHeading: "c0008",
  frameParagraph: "c0009",
  docIdConnector: "c0010",
  pointsConnector: "c0011",
} as const;

/**
 * The canvas scene (the ids follow the insertion order — the children
 * order IS the z-order): a rect, a dashed ellipse, a sized canvas-text,
 * a connector between the two shapes, a connector with an unresolvable
 * start, a frame with nested page blocks, a connector with a docId ref
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
    const heading = doc.insertBlock("heading", { level: 1 }, { parent: frame });
    doc.insertText(heading, 0, "Frame heading");
    const paragraph = doc.insertBlock("paragraph", undefined, { parent: frame });
    doc.insertText(paragraph, 0, "Frame paragraph");
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

/** The canvas-item wrappers in DOM order (the z-order pin). */
function canvasItemIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")).map(
    (el) => el.dataset.blockId as string
  );
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
    renderScene();
    expect(document.querySelector('[data-slot="docblocks/canvas"]')).not.toBeNull();
    expect(canvasItemIds()).toEqual([
      IDS.rect,
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.frame,
      IDS.docIdConnector,
      IDS.pointsConnector,
    ]);
  });

  it("reorders the elements on a moveBlock within the surface (the z-order change)", () => {
    const doc = renderScene();
    // Move the rect (index 0) to the end of the surface's children
    // (pre-move index semantics: toIndex = the current last position + 1).
    act(() => {
      doc.moveBlock(IDS.rect, IDS.surface, 8);
    });
    expect(canvasItemIds()).toEqual([
      IDS.ellipse,
      IDS.text,
      IDS.connector,
      IDS.brokenConnector,
      IDS.frame,
      IDS.docIdConnector,
      IDS.pointsConnector,
      IDS.rect,
    ]);
  });

  it("positions the elements by geometry (the center-anchor coordinate model)", () => {
    const doc = renderScene();
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
    expect(rect.style.transform).toBe("translate(-50%, -50%) rotate(0deg)");

    // A rotation update re-renders the transform.
    act(() => {
      doc.setGeometry(IDS.rect, { rotation: 45 });
    });
    expect(
      document.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${IDS.rect}"]`)!.style
        .transform
    ).toBe("translate(-50%, -50%) rotate(45deg)");
  });

  it("renders the shapes as SVGs (the variant figures, the dash style, the fill attr)", () => {
    renderScene();
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
    renderScene();
    const wrapper = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.text}"]`
    )!;
    expect(wrapper.style.fontSize).toBe("20px");
    expect(wrapper.style.textAlign).toBe("center");
    expect(screen.getByText("Canvas text")).not.toBeNull();
    const editable = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/block-content"][data-block-id="${IDS.text}"]`
    )!;
    expect(editable.getAttribute("contenteditable")).toBe("true");
  });

  it("renders the connector line between the resolved EDGES and skips the broken one (data-missing)", () => {
    renderScene({ view: "canvas" });
    const layer = document.querySelector<SVGElement>("[data-slot='docblocks/connector-layer']")!;
    const line = layer.querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
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
    // The arrowhead marker (the per-surface def).
    expect(line.getAttribute("marker-end")).toBe("url(#docblocks-conn-arrow-c0001)");
    expect(layer.querySelector("marker")).not.toBeNull();
    // The hit path (the wide transparent stroke the line clicks on).
    expect(layer.querySelector(`[data-connector-hit="${IDS.connector}"]`)).not.toBeNull();

    const label = layer.querySelector<SVGElement>(`[data-connector-label="${IDS.connector}"]`)!;
    expect(label.textContent).toBe("link");

    // The broken connector: no line, the wrapper is marked.
    expect(layer.querySelector(`[data-connector-id="${IDS.brokenConnector}"]`)).toBeNull();
    const broken = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.brokenConnector}"]`
    )!;
    expect(broken.getAttribute("data-missing")).toBe("true");

    // The docId-ref connector: the cross-doc ref is unresolvable within
    // the surface (v1) — skipped like the absent block, the wrapper marked.
    expect(layer.querySelector(`[data-connector-id="${IDS.docIdConnector}"]`)).toBeNull();
    const docIdRef = document.querySelector<HTMLElement>(
      `[data-slot="docblocks/canvas-item"][data-block-id="${IDS.docIdConnector}"]`
    )!;
    expect(docIdRef.getAttribute("data-missing")).toBe("true");

    // The points connector: a single path from the start edge anchor
    // through the waypoints to the end edge anchor (the points keep the
    // priority over the variant — the absent variant's straight shape).
    const polyline = layer.querySelector<SVGPathElement>(`[data-connector-id="${IDS.pointsConnector}"]`)!;
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

  it("renders the variant shapes (the orthogonal elbow and the curved bow)", () => {
    const doc = renderScene();
    const layer = () => document.querySelector<SVGElement>("[data-slot='docblocks/connector-layer']")!;

    // The absent variant stands straight (the default).
    const straight = layer().querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(straight.getAttribute("d")!.startsWith("M ")).toBe(true);
    expect(straight.getAttribute("d")!.includes("C ")).toBe(false);

    act(() => {
      doc.updateBlock(IDS.connector, { variant: "orthogonal" });
    });
    // The horizontal-dominant elbow: out of the east mid-edge (-40, -40),
    // the vertical bend at the mid x ((-40 + 90)/2 = 25), into the west
    // mid-edge (90, 0).
    const orthogonal = layer().querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
    expect(orthogonal.getAttribute("d")).toBe("M -40 -40 L 25 -40 L 25 0 L 90 0");

    act(() => {
      doc.updateBlock(IDS.connector, { variant: "curved" });
    });
    // The curved: the cubic bezier (the control points ride the anchored
    // edges' outward normals — the east and the west).
    const curved = layer().querySelector<SVGPathElement>(`[data-connector-id="${IDS.connector}"]`)!;
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

describe("canvas: frame", () => {
  it("renders the nested page blocks through the nested provider (same doc)", () => {
    renderScene();
    const frame = document.querySelector<HTMLElement>(`[data-slot="docblocks/frame"][data-block-id="${IDS.frame}"]`)!;
    // The nested content: the heading and the paragraph inside the frame box.
    expect(frame.querySelector("h1")!.textContent).toBe("Frame heading");
    expect(
      frame.querySelector(`[data-slot="docblocks/block-content"][data-block-id="${IDS.frameParagraph}"]`)
    ).not.toBeNull();
    // The frame's children are NOT direct children of the surface (the
    // nested provider carries them).
    expect(canvasItemIds()).not.toContain(IDS.frameHeading);
  });

  it("commits an edit inside the frame to the shared doc", () => {
    const doc = renderScene();
    const length = doc.getTextLength(IDS.frameParagraph);
    act(() => {
      doc.insertText(IDS.frameParagraph, length, " — edited");
    });
    expect(screen.getByText("Frame paragraph — edited")).not.toBeNull();
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
        <Editor />
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
  it("renders the diamond, the line diagonal, and the freehand points (the variant figures)", () => {
    const doc = createDoc({ id: "outer", createdAt: CREATED_AT });
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const diamond = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
      doc.setGeometry(diamond, { x: -100, y: 0, w: 80, h: 80 });
      const line = doc.insertBlock("shape", { variant: "line" }, { parent: surface });
      doc.setGeometry(line, { x: 0, y: 0, w: 100, h: 40 });
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
        <Editor />
      </EditorProvider>
    );

    const diamond = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="diamond"]')!;
    // The 4-point polygon: the box midpoint corners (the 80x80 box, the stroke inset 1).
    expect(diamond.querySelector("polygon")!.getAttribute("points")).toBe("40,1 79,40 40,79 1,40");

    // The line: the box diagonal (0,0) -> (w,h).
    const line = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="line"]')!;
    const lineFigure = line.querySelector("line")!;
    expect(lineFigure.getAttribute("x1")).toBe("0");
    expect(lineFigure.getAttribute("y1")).toBe("0");
    expect(lineFigure.getAttribute("x2")).toBe("100");
    expect(lineFigure.getAttribute("y2")).toBe("40");

    // The freehand points win over the variant figure: a stroke path
    // through the block-local points.
    const freehand = document.querySelector<SVGElement>('[data-slot="docblocks/shape"][data-variant="rect"]')!;
    expect(freehand.querySelector("path")!.getAttribute("d")).toBe("M 0 0 L 10 5 L 20 0");
    expect(freehand.querySelector("rect")).toBeNull();
  });
});

describe("canvas: consumer renderer", () => {
  it("wins over the built-in canvas renderers (shape and canvas-text)", () => {
    const renderers: BlockRendererMap = {
      shape: ({ id }) => <span data-custom="shape">{`custom-shape-${id}`}</span>,
      "canvas-text": ({ id }) => <span data-custom="canvas-text">{`custom-text-${id}`}</span>,
    };
    renderScene({ blockRenderers: renderers });
    // The built-in shape SVGs are gone; the custom ones render in place.
    expect(document.querySelector("[data-slot='docblocks/shape']")).toBeNull();
    expect(document.querySelector("[data-custom='shape']")!.textContent).toBe(`custom-shape-${IDS.rect}`);
    expect(document.querySelector("[data-custom='canvas-text']")!.textContent).toBe(`custom-text-${IDS.text}`);
  });
});
