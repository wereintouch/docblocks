/** The canvas view's constants: the pick / handle / toolbar offsets, the
 *  resize handles' positions and cursors, the wheel's zoom threshold, the
 *  shape / place tool id lists, the scrollbar guard. */
import type { CSSProperties } from "react";

import type { ResizeHandle } from "../../canvas";
import type { PlaceTool, ShapeTool } from "./models";

/** The connector's port-proximity pick radius (canvas px, the zoom-blind
 * space — a press / release within it of a port stands the port's shape). */
const PORT_PICK_RADIUS_PX = 14;

/** The canvas selection's outline (the shared selection token) — the
 * selected figure / page card's stand. */
const CANVAS_SELECTION_OUTLINE =
  "outline-(length:--docblocks-canvas-selection-border-width) outline-offset-1 outline-(--docblocks-canvas-selection-border-color) outline-solid";

/** The canvas items' keyboard focus's outline (the selection token's
 * dashed stand — the keyboard focus is distinct from the selection). */
const CANVAS_KB_FOCUS_OUTLINE =
  "outline-(length:--docblocks-canvas-selection-border-width) outline-offset-1 outline-(--docblocks-canvas-selection-border-color) outline-dashed";

/** The surface's background token (the `--card` fallback over its absence). */
const SURFACE_BG = "var(--docblocks-canvas-surface-background, var(--card, #ffffff))";

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

/** The shape tools' id list (the place session's gate — the dock's shape
 * ids, the non-click stands). */
const SHAPE_TOOLS: readonly ShapeTool[] = ["rect", "rounded", "ellipse", "diamond", "cylinder", "cloud"];

/** The place tools' id list (the drag-to-size session's gate). */
const PLACE_TOOLS: readonly PlaceTool[] = [...SHAPE_TOOLS, "container"];

/** The page-card scrollbar-strip guard width (the native thin bar's reach). */
const SCROLLBAR_GUARD_PX = 12;

export {
  CONNECTOR_HANDLE_HIT_RADIUS_PX,
  CONNECTOR_HANDLE_RADIUS_PX,
  PORT_PICK_RADIUS_PX,
  PLACE_TOOLS,
  RESIZE_HANDLE_POSITIONS,
  SCROLLBAR_GUARD_PX,
  SHAPE_TOOLS,
  TOOLBAR_OFFSET_PX,
  WHEEL_ZOOM_DELTA,
  CANVAS_SELECTION_OUTLINE,
  CANVAS_KB_FOCUS_OUTLINE,
  SURFACE_BG,
};
