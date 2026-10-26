// @vitest-environment jsdom
// The canvas placement commands (the dock's tools): each tool lands one
// block (plus its geometry) in one transact on the first surface
// (created when the document has none); the connector picks two siblings
// of the same surface; the pen stroke maps to the bbox geometry + the
// local points. The dock's tool buttons drive the active state.
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDoc, validateDoc } from "docblocks-core";

import { SHAPE_TOOLS, isShapeTool } from "../src/blocks/canvas-view/models";
import { CanvasDock } from "../src/canvas/CanvasDock";
import { placeCanvasText, placeConnector, placeFrame, placePenStroke, placeShape } from "../src/canvas/insert";
import type { CanvasViewportState } from "../src/canvas/viewport-state";
import { useCanvasViewport } from "../src/canvas/viewport-state";
import { placeDragBox } from "../src/canvas/viewport/utils";

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
    expect(shape?.attrs).toEqual({ variant: "ellipse", zIndex: 1 });
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
    expect(connector?.attrs).toEqual({ start: { blockId: a }, end: { blockId: b }, zIndex: 3 });
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
      zIndex: 1,
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
      pendingPort: null,
      pendingFreePort: null,
      pendingSource: null,
      zoomAt: noop,
      pinchAt: noop,
      marquee: null,
      penPoints: [],
      movePreview: null,
      moveSession: false,
      dropIndicators: null,
      placePreview: null,
      connectorPreview: null,
      connectorHoverSnap: null,
      connectorEndpoint: null,
      connectorEndpointPreview: null,
      shapeTextEditing: null,
      setShapeTextEditing: noop,
      connectorLabelEditing: null,
      setConnectorLabelEditing: noop,
      resizePreview: null,
      resizeSession: false,
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
      setConnectorHoverSnap: noop,
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
    const setPendingStand = vi.fn();
    const viewport = fakeViewport({
      mode: "default",
      activeTool: "frame",
      pendingConnector: "c0002",
      setMode,
      setActiveTool,
      setPendingStand,
    });
    render(<CanvasDock viewport={viewport} />);
    fireEvent.click(screen.getByLabelText("Switch to the pan mode"));
    expect(setMode).toHaveBeenLastCalledWith("pan");
    expect(setActiveTool).toHaveBeenLastCalledWith(null);
    expect(setPendingStand).toHaveBeenLastCalledWith(null);
  });

  it("a tool pick resets the pending stand", () => {
    const setActiveTool = vi.fn();
    const setPendingStand = vi.fn();
    render(<CanvasDock viewport={fakeViewport({ pendingConnector: "c0001", setActiveTool, setPendingStand })} />);
    fireEvent.click(screen.getByLabelText("Text"));
    expect(setPendingStand).toHaveBeenLastCalledWith(null);
    expect(setActiveTool).toHaveBeenLastCalledWith("text");
  });
});

describe("the shape tools' gate (the place session's stand)", () => {
  it("every shape variant stands the drag-to-size session (cylinder / cloud included)", () => {
    expect(SHAPE_TOOLS).toEqual(["rect", "rounded", "ellipse", "diamond", "cylinder", "cloud"]);
    for (const tool of SHAPE_TOOLS) expect(isShapeTool(tool), tool).toBe(true);
  });

  it("the click-place and the non-shape tools stand their own stands", () => {
    expect(isShapeTool("text")).toBe(false);
    expect(isShapeTool("frame")).toBe(false);
    expect(isShapeTool("connector")).toBe(false);
    expect(isShapeTool("pen")).toBe(false);
  });
});

describe("the pending stand's commit (the press's snap stand)", () => {
  function connectorDoc() {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
    const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
    return { doc, surface, a, b };
  }

  function lastConnector(doc: TestDoc, surface: string) {
    const child = doc
      .getChildren(surface)
      .map((id) => doc.getBlock(id))
      .find((block) => block?.type === "connector");
    if (child === undefined || child === null || child.type !== "connector") {
      throw new Error("the connector is missing");
    }
    return child.attrs;
  }

  it("the port stand commits the port ref (no re-snap at the press point)", () => {
    const { doc, surface, a, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ blockId: a, port: "north" }, { x: -100, y: -33 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 0 });
    });

    // The port stand stands the legacy port ref (the portT's 0.5 stand —
    // the endpoint drag's commit parity); the second stand's release
    // (the right box's center) stands off the ports — the plain ref.
    expect(lastConnector(doc, surface)).toEqual({
      start: { blockId: a, port: "north", portT: 0.5 },
      end: { blockId: b },
      zIndex: 3,
    });
  });

  it("the free stand commits the press point with the frozen direction", () => {
    const { doc, surface, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ free: { x: -30, y: 40 }, freePort: "south" }, { x: -30, y: 40 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 40 });
    });

    // The release point (100, 40) stands 10px from B's south port (the
    // disk's): the second stand's release snap stands the port ref (the
    // legacy commit's contract).
    expect(lastConnector(doc, surface)).toEqual({
      start: { x: -30, y: 40, port: "south" },
      end: { blockId: b, port: "south", portT: 0.5 },
      zIndex: 3,
    });
  });

  it("the legacy free stand (the empty-canvas press) stands no direction", () => {
    const { doc, surface, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ free: { x: 0, y: 50 } }, { x: 0, y: 50 });
    });
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 50 });
    });

    expect(lastConnector(doc, surface)).toEqual({ start: { x: 0, y: 50 }, end: { blockId: b }, zIndex: 3 });
  });

  it("the plain block stand (the interior press) re-snaps at the press point (the legacy path)", () => {
    const { doc, surface, a, b } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      // The interior press (the box's center): no snap at the press. The
      // source stands the self-pair guard (the stand's own block).
      result.current.setPendingStand({ blockId: a, source: a }, { x: -100, y: 0 });
    });
    expect(result.current.pendingSource).toBe(a);
    act(() => {
      result.current.onConnectorCommit({ blockId: b }, { x: 100, y: 0 });
    });

    expect(lastConnector(doc, surface)).toEqual({ start: { blockId: a }, end: { blockId: b }, zIndex: 3 });
  });

  it("clears the stand's attributes on the cancel", () => {
    const { doc, a } = connectorDoc();
    const { result } = renderHook(() => useCanvasViewport(doc));

    act(() => {
      result.current.setPendingStand({ blockId: a, port: "east" }, { x: 0, y: 0 });
    });
    expect(result.current.pendingPort).toBe("east");

    act(() => {
      result.current.setPendingStand({ free: { x: 1, y: 2 }, freePort: "south" }, { x: 1, y: 2 });
    });
    expect(result.current.pendingFreePort).toBe("south");
    expect(result.current.pendingPort).toBeNull();

    act(() => {
      result.current.setPendingStand(null);
    });
    expect(result.current.pendingPort).toBeNull();
    expect(result.current.pendingFreePort).toBeNull();
    expect(result.current.pendingSource).toBeNull();
    expect(result.current.pendingConnector).toBeNull();
    expect(result.current.pendingFree).toBeNull();
  });
});

describe("placeDragBox (the drag-to-size place's box — the shift's 1:1)", () => {
  const START = { x: 0, y: 0 };

  it("the free drag (no shift) stands the drag's extent W×H", () => {
    expect(placeDragBox(START, { x: 120, y: 80 }, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
    // The symmetric scene (the negative spans — the abs's stand).
    expect(placeDragBox(START, { x: -90, y: -40 }, false)).toEqual({ x: -45, y: -20, w: 90, h: 40 });
  });

  it("the shift stands the square (W = H) — the larger span wins (both drag directions)", () => {
    // dx > dy: the square's side is dx.
    expect(placeDragBox(START, { x: 120, y: 80 }, true)).toEqual({ x: 60, y: 40, w: 120, h: 120 });
    // dy > dx: the square's side is dy (the vertical drag's winner).
    expect(placeDragBox(START, { x: 40, y: 200 }, true)).toEqual({ x: 20, y: 100, w: 200, h: 200 });
    // The center is the drag's midpoint (the constraint stands the size, not the anchor).
    expect(placeDragBox(START, { x: -100, y: 60 }, true)).toEqual({ x: -50, y: 30, w: 100, h: 100 });
  });

  it("the live shift toggle over the same input (the constraint stands / drops)", () => {
    const drag = { x: 120, y: 80 };
    expect(placeDragBox(START, drag, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
    expect(placeDragBox(START, drag, true)).toEqual({ x: 60, y: 40, w: 120, h: 120 });
    // The toggle back: the free box stands again (the same input).
    expect(placeDragBox(START, drag, false)).toEqual({ x: 60, y: 40, w: 120, h: 80 });
  });

  it("the 1 px floor stands over the degenerate drag (a zero extent commits a 1 px figure)", () => {
    expect(placeDragBox(START, { x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(placeDragBox(START, { x: 0, y: 0 }, true)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    // A sub-px drag stands the 1 px floor (the w / h never stand 0).
    expect(placeDragBox(START, { x: 0.4, y: 0.2 }, false)).toEqual({ x: 0.2, y: 0.1, w: 1, h: 1 });
  });
});
