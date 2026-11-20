/** The canvas viewport's in-flight gesture shapes: the placement preview, the
 *  marquee, and the move / resize sessions with their rendered previews. */
import type { Box } from "../../geometry";
import type { ResizeHandle, ScreenPoint } from "./points";

/** The in-flight placement's preview (the center anchor, canvas coords).
 * `kind` stands the preview's figure: a shape (the variant's silhouette)
 * or the container (the plain rectangle border). */
interface PlacePreview {
  kind: "shape" | "container";
  variant: "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The marquee's corners during the drag (the container space, center-relative). */
interface MarqueeState {
  start: ScreenPoint;
  end: ScreenPoint;
}

/**
 * The in-flight move session (the mutable per-gesture data lives in the
 * hook's ref; only the preview offset is render state). The snapshot
 * carries the effective geometry of each moved id (the stored geometry or
 * the synthesized default box — the release commit is a complete x/y
 * patch regardless of what the block carried).
 */
interface MoveSession {
  ids: string[];
  startClientX: number;
  startClientY: number;
  snapshot: Record<string, { x: number; y: number; w: number; h: number } | undefined>;
  /** The block types over the ids (the session stand — the pointermove's indicator pass reads the session, not the doc). */
  types: Record<string, string>;
  /** The containers at the session's start (the membership / the geometry stand stable over the drag — the release's commit stands the fresh read). */
  containers: { id: string; box: Box; members: string[] }[];
  /** The dragged groups' members (the session stand). */
  groupMembers: Record<string, string[]>;
  dragging: boolean;
  /** The last committed-candidate delta (canvas px), fed by moveDrag. */
  dx: number;
  dy: number;
}

/** The rendered move preview (canvas px, applied to the moved items).
 * `idSet` stands the per-item O(1) membership read (the item's narrow
 * store selector: the pointermove re-renders the moved items only). */
interface MovePreview {
  ids: string[];
  idSet: ReadonlySet<string>;
  dx: number;
  dy: number;
}

/**
 * The in-flight move's drop indicator: the
 * dragged figure lands in a container it is not yet a member of (kind "in"
 * — the green icon), or a member is dragged out of its own container (kind
 * "out" — the red icon). Pure view state: the doc writes on the release
 * only (the membership commit stands in the move's one transact).
 */
interface DropIndicator {
  /** The dragged figure's block id (the icon stands over it). */
  id: string;
  /** The container's group id (the drop target). */
  containerId: string;
  /** "in" (the drop-in — green) or "out" (the member leaving — red). */
  kind: "in" | "out";
}

/** The in-flight resize session (one item, one handle). */
interface ResizeSession {
  id: string;
  handle: ResizeHandle;
  snapshot: Box;
  startClientX: number;
  startClientY: number;
  dragging: boolean;
  box: Box | null;
  /** The container's members' union box (the resize's per-edge clamp); absent
   * for a shape (the plain floor-only resize). */
  memberUnion?: Box;
}

export type { DropIndicator, MarqueeState, MovePreview, MoveSession, PlacePreview, ResizeSession };
