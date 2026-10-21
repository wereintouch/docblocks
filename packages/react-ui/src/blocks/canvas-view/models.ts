/** The canvas view's constants (the pick / handle / toolbar offsets, the
 *  resize handles' positions and cursors, the wheel's zoom threshold, the
 *  scrollbar guard) and the session types. */
import type { CSSProperties } from "react";

import type { CanvasPoint, CanvasTool, ResizeHandle } from "../../canvas/viewport";

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

/** The rotate handle's offset above the box top edge (screen px). */
const HANDLE_ROTATE_OFFSET_PX = 24;

/** The connector endpoint handle's visible radius (screen px — the
 * screen-space handle keeps its on-screen size at any zoom, like the
 * resize handles). */
const CONNECTOR_HANDLE_RADIUS_PX = 4;

/** The connector endpoint handle's hit radius (the wider invisible area,
 * screen px). */
const CONNECTOR_HANDLE_HIT_RADIUS_PX = 8;

/** The shape toolbar's offset above the box top edge (screen px): it
 * stands over the rotate handle (24px), so it clears the handle zone. */
const TOOLBAR_OFFSET_PX = 48;

/** The wheel's zoom step's delta threshold (a mouse notch's ~100 px; the
 * trackpad's small deltas accumulate to the same step). */
const WHEEL_ZOOM_DELTA = 100;

/** The shape placement tools (the drag-to-size gesture's tools). */
type ShapeTool = Extract<CanvasTool, "rect" | "rounded" | "ellipse" | "diamond">;

/** The in-flight canvas pointer session (the primary button only). */
type CanvasSession =
  | { kind: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: "marquee"; additive: boolean }
  | { kind: "pen"; points: { x: number; y: number }[] }
  | { kind: "place"; tool: ShapeTool; start: CanvasPoint; startClientX: number; startClientY: number };

/** The page-card scrollbar-strip guard width (the native thin bar's reach). */
const SCROLLBAR_GUARD_PX = 12;

export {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  HANDLE_ROTATE_OFFSET_PX,
  PORT_PICK_RADIUS_PX,
  RESIZE_HANDLE_POSITIONS,
  SCROLLBAR_GUARD_PX,
  TOOLBAR_OFFSET_PX,
  WHEEL_ZOOM_DELTA,
};
export type { CanvasSession, ShapeTool };
