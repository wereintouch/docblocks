/** The canvas viewport's dock sets: the placement tools and the pointer mode. */

/** The placement tool ids (the dock's tool set; "hand" is a mode, not a tool). */
type CanvasTool =
  | "rect"
  | "rounded"
  | "ellipse"
  | "diamond"
  | "cylinder"
  | "cloud"
  | "container"
  | "text"
  | "frame"
  | "connector"
  | "pen";

/** The pointer mode (the dock's hand toggle). */
type CanvasMode = "default" | "pan";

export type { CanvasMode, CanvasTool };
