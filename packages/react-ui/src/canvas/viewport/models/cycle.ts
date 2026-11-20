/** The container drill-down's shapes: the session (the click anchor and the
 *  camera it stood under) and the transient `i / N` indicator. */
import type { ScreenPoint } from "./points";

/** The drill-down's session: the click point (the container space) the
 * radius stands around, the moment of the last cycling click, the camera the
 * session stood under (any camera change drops it), and the pointer type
 * (the touch's wider radius). */
interface CycleSession {
  anchor: ScreenPoint;
  at: number;
  zoom: number;
  panX: number;
  panY: number;
  pointerType: string;
}

/** The drill-down's transient indicator: the click point, the candidate's
 * position in the stack (1-based) and the stack's size. */
interface CycleIndicator {
  point: ScreenPoint;
  index: number;
  count: number;
  /** The stand's identity (a fresh value re-arms the fade). */
  nonce: number;
}

export type { CycleIndicator, CycleSession };
