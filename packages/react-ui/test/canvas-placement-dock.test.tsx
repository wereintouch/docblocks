// @vitest-environment jsdom
// The canvas dock's tool buttons (the active state's driver): the hand's
// toggle, the shapes' menu, the tool's pick / cancel, the active's mark
// (aria-pressed), and the shape tools' gate (the place session's stand).
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasDock } from "../src/canvas/CanvasDock";
import { PLACE_TOOLS, SHAPE_TOOLS } from "../src/canvas/canvas-view/constants";
import { isPlaceTool, isShapeTool } from "../src/canvas/canvas-view/utils";
import type { CanvasViewportState } from "../src/canvas/viewport";

afterEach(cleanup);

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
      pendingText: null,
      setPendingText: noop,
      connectorPreview: null,
      connectorHoverSnap: null,
      connectorEndpoint: null,
      connectorEndpointPreview: null,
      shapeTextEditing: null,
      setShapeTextEditing: noop,
      canvasTextEditing: null,
      setCanvasTextEditing: noop,
      connectorLabelEditing: null,
      setConnectorLabelEditing: noop,
      kbFocusId: null,
      cycle: null,
      cycleIndicator: null,
      setCycle: noop,
      setCycleIndicator: noop,
      setKbFocusId: noop,
      resizePreview: null,
      resizeSession: false,
      setZoom: noop,
      stepZoom: noop,
      setPan: noop,
      setMode: noop,
      setActiveTool: noop,
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
    const { rerender } = render(<CanvasDock viewport={fakeViewport({ activeTool: null, setActiveTool, setMode })} />);
    fireEvent.pointerDown(screen.getByLabelText("Shapes"));
    fireEvent.click(screen.getByLabelText("Rectangle"));
    expect(setActiveTool).toHaveBeenLastCalledWith("rect");
    // The pick moves the mode back to the default.
    expect(setMode).toHaveBeenLastCalledWith("default");
    // The re-pick (the tool is now active) cancels it.
    rerender(<CanvasDock viewport={fakeViewport({ activeTool: "rect", setActiveTool, setMode })} />);
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

  it("the place tools' stand: the shapes + the container + the frame (the drag-to-size's gate)", () => {
    expect(PLACE_TOOLS).toEqual(["rect", "rounded", "ellipse", "diamond", "cylinder", "cloud", "container", "frame"]);
    expect(isPlaceTool("frame")).toBe(true);
    expect(isPlaceTool("container")).toBe(true);
    expect(isPlaceTool("text")).toBe(false);
    expect(isPlaceTool("connector")).toBe(false);
  });
});
