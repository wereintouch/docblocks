/** The canvas view's session types. */
import type { CanvasPoint, CanvasTool } from "../../canvas";

/** The shape placement tools (the drag-to-size gesture's tools — every
 * shape variant). */
type ShapeTool = Extract<CanvasTool, "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud">;

/** The placement tools with the drag-to-size gesture (the shape variants
 * + the container + the frame —; the container's and
 * the frame's box is its own free geometry, like the shapes). */
type PlaceTool = ShapeTool | "container" | "frame";

/** The plain repeat press's pending step (the drill-down's stack and the
 * target's index): the release applies it over a click (no drag) — a drag
 * stands the move instead. */
interface PendingCycleStep {
  ids: string[];
  index: number;
  point: { x: number; y: number };
  pointerType: string;
}

/** The in-flight canvas pointer session (the primary button only). */
type CanvasPointerSession =
  | { kind: "pan"; startClientX: number; startClientY: number; startPanX: number; startPanY: number }
  | { kind: "marquee"; additive: boolean }
  | { kind: "pen"; points: { x: number; y: number }[] }
  | {
      kind: "place";
      tool: PlaceTool;
      start: CanvasPoint;
      startClientX: number;
      startClientY: number;
      lastPoint: CanvasPoint;
    };

export type { CanvasPointerSession, PendingCycleStep, PlaceTool, ShapeTool };
