/** The canvas view's session types. */
import type { CanvasPoint, CanvasTool } from "../../canvas";

/** The shape placement tools (the drag-to-size gesture's tools — every
 * shape variant). */
type ShapeTool = Extract<CanvasTool, "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud">;

/** The placement tools with the drag-to-size gesture (the shape variants
 * + the container —; the container's box is
 * its own free geometry, like the shapes). */
type PlaceTool = ShapeTool | "container";

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

export type { CanvasPointerSession, PlaceTool, ShapeTool };
