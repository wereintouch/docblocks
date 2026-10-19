// @vitest-environment jsdom
// The canvas placement commands (the dock's tools): each tool lands one
// block (plus its geometry) in one transact on the first surface
// (created when the document has none); the connector picks two siblings
// of the same surface; the pen stroke maps to the bbox geometry + the
// local points. The dock's tool buttons drive the active state.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { CanvasDock } from "../src/canvas/CanvasDock";
import { placeCanvasText, placeConnector, placeFrame, placePenStroke, placeShape } from "../src/canvas/insert";
import type { CanvasViewportState } from "../src/canvas/viewport-state";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

type TestDoc = ReturnType<typeof createDoc>;

function newDoc(): TestDoc {
  return createDoc({ id: "placement-doc", createdAt: CREATED_AT });
}

afterEach(cleanup);

describe("placeShape", () => {
  it("creates the surface and the shape (geometry at the point) in one transact", () => {
    const doc = newDoc();
    const id = placeShape(doc, "ellipse", { x: 12, y: -8 }, { w: 100, h: 80 });
    const block = doc.getBlock(id);
    const shape = block?.type === "shape" ? block : null;
    expect(shape).not.toBeNull();
    expect(shape?.attrs).toEqual({ variant: "ellipse" });
    expect(shape?.geometry).toEqual({ x: 12, y: -8, w: 100, h: 80 });
    // The target: the (created) first surface — the only root child (a
    // fresh doc has no page blocks: the starter paragraph is the consumer's).
    const root = doc.getBlock(doc.meta.id);
    if (root === null || root.type !== "root") throw new Error("the root block is missing");
    expect(root.children).toHaveLength(1);
    expect(doc.getChildren(root.children[0]!)).toEqual([id]);
    // One undo step: the whole placement is a single transact.
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("reuses an existing surface", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const id = placeShape(doc, "diamond", { x: 0, y: 0 }, { w: 90, h: 90 });
    expect(doc.getChildren(surface)).toEqual([id]);
    expect(doc.getChildren(doc.meta.id)).toHaveLength(1); // no second surface
  });
});

describe("placeCanvasText", () => {
  it("lands the canvas-text with the default size at the point", () => {
    const doc = newDoc();
    const id = placeCanvasText(doc, { x: 20, y: 30 }, { w: 200, h: 40 });
    expect(doc.getBlock(id)?.type).toBe("canvas-text");
    expect(doc.getBlock(id)?.geometry).toEqual({ x: 20, y: 30, w: 200, h: 40 });
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
  });
});

describe("placeFrame", () => {
  it("lands the frame with a starter paragraph (one transact)", () => {
    const doc = newDoc();
    const id = placeFrame(doc, { x: -40, y: 10 }, { w: 320, h: 240 });
    const frame = doc.getBlock(id);
    expect(frame?.type).toBe("frame");
    expect(frame?.geometry).toEqual({ x: -40, y: 10, w: 320, h: 240 });
    const children = doc.getChildren(id);
    expect(children).toHaveLength(1);
    expect(doc.getBlock(children[0]!)?.type).toBe("paragraph");
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("placeConnector", () => {
  it("creates the connector between two siblings of the same surface", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    const id = placeConnector(doc, a, b);
    const raw = doc.getBlock(id);
    const connector = raw?.type === "connector" ? raw : null;
    expect(connector).not.toBeNull();
    expect(connector?.attrs).toEqual({ start: { blockId: a }, end: { blockId: b } });
    expect(doc.getChildren(surface)).toEqual([a, b, id]);
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
  });

  it("rejects a cross-surface pair and creates nothing", () => {
    const doc = newDoc();
    const s1 = doc.insertBlock("surface");
    const s2 = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: s1 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: s2 });
    const before = doc.toJSON();
    expect(() => placeConnector(doc, a, b)).toThrow(/same surface/);
    expect(doc.toJSON()).toEqual(before);
  });
});

describe("placePenStroke", () => {
  it("lands the shape with the bbox geometry and the local points", () => {
    const doc = newDoc();
    const id = placePenStroke(doc, {
      geometry: { x: 10, y: 5, w: 24, h: 10 },
      points: [
        [0, 0],
        [12, 10],
        [24, 0],
      ],
    });
    const block = doc.getBlock(id);
    const shape = block?.type === "shape" ? block : null;
    expect(shape).not.toBeNull();
    expect(shape?.attrs).toEqual({
      variant: "rect",
      points: [
        [0, 0],
        [12, 10],
        [24, 0],
      ],
    });
    expect(shape?.geometry).toEqual({ x: 10, y: 5, w: 24, h: 10 });
    doc.undo();
    expect(doc.getBlock(id)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("the dock", () => {
  // The dock is a pure props component (the viewport state object) — a
  // fake viewport stands for the hook.
  function fakeViewport(overrides: Partial<CanvasViewportState> = {}): CanvasViewportState {
    const noop = vi.fn();
    const base: CanvasViewportState = {
      zoom: 1,
      pan: { x: 0, y: 0 },
      mode: "default",
      activeTool: null,
      pendingConnector: null,
      pendingFree: null,
      zoomAt: noop,
      marquee: null,
      penPoints: [],
      movePreview: null,
      placePreview: null,
      connectorPreview: null,
      connectorEndpoint: null,
      connectorEndpointPreview: null,
      shapeTextEditing: null,
      setShapeTextEditing: noop,
      resizePreview: null,
      rotatePreview: null,
      setZoom: noop,
      stepZoom: noop,
      setPan: noop,
      setMode: noop,
      setActiveTool: noop,
      setPendingConnector: noop,
      setPendingStand: noop,
      setMarquee: noop,
      setPenPoints: noop,
      marqueeRect: null,
      onPlace: noop,
      onPlaceSize: noop,
      setPlacePreview: noop,
      setConnectorPreview: noop,
      onConnectorPick: noop,
      onConnectorCommit: noop,
      onPen: noop,
      beginConnectorEndpoint: noop,
      moveConnectorEndpoint: noop,
      endConnectorEndpoint: noop,
      cancelConnectorEndpoint: noop,
      beginMove: noop,
      moveDrag: noop,
      endMove: noop,
      cancelMove: noop,
      beginResize: noop,
      resizeDrag: noop,
      endResize: noop,
      cancelResize: noop,
      beginRotate: noop,
      rotateDrag: noop,
      endRotate: noop,
      cancelRotate: noop,
    };
    return { ...base, ...overrides } as CanvasViewportState;
  }

  it("lists the hand toggle, the shapes' single button, and the other tools", () => {
    render(<CanvasDock viewport={fakeViewport()} />);
    expect(screen.getByRole("toolbar", { name: "Canvas tools" })).toBeTruthy();
    expect(screen.getByLabelText("Switch to the pan mode")).toBeTruthy();
    for (const label of ["Shapes", "Text", "Frame", "Connector", "Pen"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
    // The shape types stand behind the shapes' button (not on the dock
    // itself).
    expect(screen.queryByLabelText("Rectangle")).toBeNull();
  });

  it("opens the horizontal shapes menu (the four types) on the shapes' button", () => {
    render(<CanvasDock viewport={fakeViewport()} />);
    // The radix dropdown trigger toggles on pointerdown.
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    const menu = screen.getByLabelText("Shapes menu");
    expect((menu.getAttribute("class") ?? "").includes("flex flex-row")).toBe(true);
    for (const label of ["Rectangle", "Rounded Rectangle", "Ellipse", "Diamond"]) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it("picks a shape tool from the menu and cancels it on the re-pick", () => {
    const setActiveTool = vi.fn();
    const setMode = vi.fn();
    const setPendingConnector = vi.fn();
    const { rerender } = render(
      <CanvasDock viewport={fakeViewport({ activeTool: null, setActiveTool, setMode, setPendingConnector })} />
    );
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(setActiveTool).toHaveBeenLastCalledWith("rect");
    // The pick moves the mode back to the default.
    expect(setMode).toHaveBeenLastCalledWith("default");
    // The re-pick (the tool is now active) cancels it.
    rerender(
      <CanvasDock viewport={fakeViewport({ activeTool: "rect", setActiveTool, setMode, setPendingConnector })} />
    );
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(setActiveTool).toHaveBeenLastCalledWith(null);
  });

  it("marks the active tool (aria-pressed) and the hand state", () => {
    const { rerender } = render(<CanvasDock viewport={fakeViewport({ activeTool: "pen" })} />);
    expect(screen.getByLabelText("Pen").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByLabelText("Shapes").getAttribute("aria-pressed")).toBe("false");
    rerender(<CanvasDock viewport={fakeViewport({ activeTool: "ellipse" })} />);
    expect(screen.getByLabelText("Shapes").getAttribute("aria-pressed")).toBe("true");
    rerender(<CanvasDock viewport={fakeViewport({ mode: "pan" })} />);
    // The mode's button: the label and the icon stand the current mode
    // (the hand for the pan, the pointer for the select).
    expect(screen.getByLabelText("Switch to the select mode").getAttribute("aria-pressed")).toBe("true");
    // The icon's path stands the current mode (the hand's first path /
    // the pointer's path).
    expect(screen.getByLabelText("Switch to the select mode").querySelector("svg path")?.getAttribute("d")).toBe(
      "M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"
    );
    rerender(<CanvasDock viewport={fakeViewport({ mode: "default" })} />);
    expect(screen.getByLabelText("Switch to the pan mode").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByLabelText("Switch to the pan mode").querySelector("svg path")?.getAttribute("d")).toBe(
      "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z"
    );
  });

  it("the hand toggle switches the mode and drops the active tool", () => {
    const setMode = vi.fn();
    const setActiveTool = vi.fn();
    const setPendingConnector = vi.fn();
    const viewport = fakeViewport({
      mode: "default",
      activeTool: "frame",
      pendingConnector: "c0002",
      setMode,
      setActiveTool,
      setPendingConnector,
    });
    render(<CanvasDock viewport={viewport} />);
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(setMode).toHaveBeenLastCalledWith("pan");
    expect(setActiveTool).toHaveBeenLastCalledWith(null);
    expect(setPendingConnector).toHaveBeenLastCalledWith(null);
  });

  it("a tool pick resets the pending connector", () => {
    const setActiveTool = vi.fn();
    const setPendingConnector = vi.fn();
    render(<CanvasDock viewport={fakeViewport({ pendingConnector: "c0001", setActiveTool, setPendingConnector })} />);
    fireEvent.click(screen.getByLabelText("Text"));
    expect(setPendingConnector).toHaveBeenLastCalledWith(null);
    expect(setActiveTool).toHaveBeenLastCalledWith("text");
  });
});
