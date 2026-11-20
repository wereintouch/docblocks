/** The connector endpoint drag's shapes: the in-flight session, the dragged
 *  handle target, the edge snap, and the rendered preview. */
import type { CanvasPort } from "../../geometry";
import type { CanvasPoint } from "./points";

/**
 * The in-flight connector endpoint drag (one connector, one endpoint).
 * The preview point stands in the CANVAS (world) space — the space the
 * canvas view's surface children stand in (the surface's geometry stands
 * no shift: the children render at the world's origin parity); the
 * session carries the point so the release commit reads the session, not
 * the closure.
 */
interface EndpointSession {
  connectorId: string;
  surfaceId: string;
  which: "start" | "end";
  /** The press's client point (the release threshold anchor). */
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  /** The last preview point (canvas px), fed by the move. */
  point: CanvasPoint;
  /** The endpoint's frozen direction (the last anchor's side — the free
   *  point commit keeps it; the re-connection to an edge takes the
   *  edge's side over it). */
  direction: CanvasPort | null;
}

/** The rendered endpoint drag target (the handles' live preview). */
interface EndpointDrag {
  connectorId: string;
  which: "start" | "end";
}

/** The endpoint drag's edge snap (the sibling block, the side, and the
 * fractional position along it — the continuous anchor). */
interface EndpointSnap {
  blockId: string;
  port: CanvasPort;
  t: number;
}

/** The endpoint drag's live preview (the raw point + the port snap, if any). */
interface EndpointPreview {
  point: CanvasPoint;
  snap: EndpointSnap | null;
}

export type { EndpointDrag, EndpointPreview, EndpointSession, EndpointSnap };
