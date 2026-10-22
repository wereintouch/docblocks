/** The canvas view's constants (the pick / handle / toolbar offsets, the
 *  resize handles' positions and cursors, the wheel's zoom threshold, the
 *  scrollbar guard) and the session types. */
import type { CSSProperties } from "react";

import type { CanvasMode, CanvasPoint, CanvasTool, ResizeHandle } from "../../canvas/viewport";

/** The connector's port-proximity pick radius (canvas px, the zoom-blind
 * space — a press / release within it of a port stands the port's shape). */
const PORT_PICK_RADIUS_PX = 14;

/** The eight resize handles' positions (box percentages) + cursors. */
const RESIZE_HANDLE_POSITIONS: { handle: ResizeHandle; className: string; style: CSSProperties }[] = [
  { handle: "nw", className: "cursor-nwse-resize", style: { left: 0, top: 0, transform: "translate(-50%, -50%)" } },
  { handle: "n", className: "cursor-ns-resize", style: { left: "50%", top: 0, transform: "translate(-50%, -50%)" } },
  {
    handle: "ne",
    className: "cursor-nesw-resize",
    style: { left: "100%", top: 0, transform: "translate(-50%, -50%)" },
  },
  {
    handle: "e",
    className: "cursor-ew-resize",
    style: { left: "100%", top: "50%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "se",
    className: "cursor-nwse-resize",
    style: { left: "100%", top: "100%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "s",
    className: "cursor-ns-resize",
    style: { left: "50%", top: "100%", transform: "translate(-50%, -50%)" },
  },
  {
    handle: "sw",
    className: "cursor-nesw-resize",
    style: { left: 0, top: "100%", transform: "translate(-50%, -50%)" },
  },
  { handle: "w", className: "cursor-ew-resize", style: { left: 0, top: "50%", transform: "translate(-50%, -50%)" } },
];

/** The connector endpoint handle's visible radius (screen px — the
 * screen-space handle keeps its on-screen size at any zoom, like the
 * resize handles). */
const CONNECTOR_HANDLE_RADIUS_PX = 4;

/** The connector endpoint handle's hit radius (the wider invisible area,
 * screen px). */
const CONNECTOR_HANDLE_HIT_RADIUS_PX = 8;

/** The shape toolbar's offset above the box top edge (screen px — the
 * clearance over the box edge and the resize handles' zone). */
const TOOLBAR_OFFSET_PX = 48;

/** The wheel's zoom step's delta threshold (a mouse notch's ~100 px; the
 * trackpad's small deltas accumulate to the same step). */
const WHEEL_ZOOM_DELTA = 100;

/** The wheel's gesture: the zoom stands
 * under the active tool, the pinch (ctrl/cmd), and the hand mode without
 * the shift; the pointer mode pans (the 1:1 screen-px stand, the shift's
 * horizontal axis). */
function wheelGesture(
  mode: CanvasMode,
  tool: CanvasTool | null,
  flags: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }
): "pan" | "zoom" {
  if (tool !== null || flags.ctrlKey || flags.metaKey) return "zoom";
  if (mode === "pan" && !flags.shiftKey) return "zoom";
  return "pan";
}

/** The wheel-pan's axis deltas (screen px, the 1:1 stand): the content

 * — the wheel down stands the canvas up). The shift stands the horizontal
 * axis only (the browser maps the shifted vertical wheel onto deltaX;
 * the unconverted notch takes the deltaY fallback). */
function wheelPanDeltas(deltaX: number, deltaY: number, shiftKey: boolean): { dx: number; dy: number } {
  if (!shiftKey) return { dx: -deltaX || 0, dy: -deltaY || 0 };
  const x = deltaX !== 0 ? deltaX : deltaY;
  return { dx: -x || 0, dy: 0 };
}

/** The shape placement tools (the drag-to-size gesture's tools — every
 * shape variant). */
type ShapeTool = Extract<CanvasTool, "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud">;

/** The shape tools' id list (the place session's gate — the dock's shape
 * ids, the non-click stands). */
const SHAPE_TOOLS: readonly ShapeTool[] = ["rect", "rounded", "ellipse", "diamond", "cylinder", "cloud"];

/** The placement tools with the drag-to-size gesture (the shape variants
 * + the container —; the container's box is
 * its own free geometry, like the shapes). */
type PlaceTool = ShapeTool | "container";

/** The place tools' id list (the drag-to-size session's gate). */
const PLACE_TOOLS: readonly PlaceTool[] = [...SHAPE_TOOLS, "container"];

/** The shape tool's stand (the drag-to-size session's gate, against the
 * click-to-place tools). */
function isShapeTool(tool: CanvasTool): tool is ShapeTool {
  return (SHAPE_TOOLS as readonly CanvasTool[]).includes(tool);
}

/** The place tool's stand (the drag-to-size session's gate, against the
 * click-to-place tools — the shapes + the container). */
function isPlaceTool(tool: CanvasTool): tool is PlaceTool {
  return (PLACE_TOOLS as readonly CanvasTool[]).includes(tool);
}

/** The in-flight canvas pointer session (the primary button only). */
type CanvasSession =
  | { kind: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: "marquee"; additive: boolean }
  | { kind: "pen"; points: { x: number; y: number }[] }
  | { kind: "place"; tool: PlaceTool; start: CanvasPoint; startClientX: number; startClientY: number };

/** The page-card scrollbar-strip guard width (the native thin bar's reach). */
const SCROLLBAR_GUARD_PX = 12;

export {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  PORT_PICK_RADIUS_PX,
  RESIZE_HANDLE_POSITIONS,
  SCROLLBAR_GUARD_PX,
  SHAPE_TOOLS,
  TOOLBAR_OFFSET_PX,
  WHEEL_ZOOM_DELTA,
  isShapeTool,
  isPlaceTool,
  wheelGesture,
  wheelPanDeltas,
};
export type { CanvasSession, PlaceTool, ShapeTool };
