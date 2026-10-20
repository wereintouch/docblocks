/** The motion editor's pure helpers: the drag event's pointer Y (the
 *  seam measurement's input) and the tail seat's id (the drag's preview
 *  clamp). */
import { BLOCK_REGISTRY, type Doc } from "docblocks-core";

import { segmentRange } from "../editing/block-commands";

/**
 * The drag's pointer Y (the seam measurement's input): the pointer/mouse
 * event's clientY, or the last changed touch's (the touch release event
 * carries no coordinate of its own). Null when the event stands no
 * usable coordinate (the measurement is stale — the caller keeps the
 * preview or skips the commit).
 */
function pointerYOf(event: PointerEvent | MouseEvent | TouchEvent): number | null {
  if (event instanceof TouchEvent) {
    const touch = event.changedTouches[event.changedTouches.length - 1];
    return touch === null || touch === undefined ? null : touch.clientY;
  }
  return event.clientY;
}

/**
 * The tail seat's id for the drag's preview clamp (or undefined when the
 * clamp does not stand): the seat is the full-doc root's trailing row
 * (the guaranteed trailing text paragraph), and it stands for a dragged
 * row whose derived segment is NON-TEXT-terminated (a text-terminated
 * segment lands its text tail last — the doc's tail invariant stands and
 * the crossing is clean — no clamp, the end landing is the preview's
 * stand). The seat's own drag stands unclamped too (it is a real block).
 */
function tailSeatId(
  doc: Doc,
  rootBlockId: string,
  draggedId: string,
  trailingRowId: string | undefined
): string | undefined {
  if (trailingRowId === undefined || draggedId === trailingRowId) return undefined;
  const segment = segmentRange(doc, rootBlockId, draggedId);
  if (segment === null) return undefined;
  const lastId = doc.getChildren(rootBlockId)[segment.end - 1];
  if (lastId === undefined) return undefined;
  const lastBlock = doc.getBlock(lastId);
  if (lastBlock === null) return undefined;
  if (BLOCK_REGISTRY[lastBlock.type].content) return undefined;
  // The seat is a TOP-LEVEL trailing block only: the commit's seat (the
  // segment lands just before it) would re-attach a nested trailing block
  // to the childless non-text segment, so the commit stands the end
  // landing there — the preview stands it too (the clamp's stand must
  // match the commit's).
  const trailingBlock = doc.getBlock(trailingRowId);
  if (trailingBlock === null || trailingRowId === lastId) return undefined;
  if (!BLOCK_REGISTRY[trailingBlock.type].content) return undefined;
  const trailingAttrs =
    "attrs" in trailingBlock ? (trailingBlock.attrs as Record<string, unknown> | undefined) : undefined;
  const trailingIndent = typeof trailingAttrs?.indent === "number" ? trailingAttrs.indent : 0;
  return trailingIndent === 0 ? trailingRowId : undefined;
}

export { pointerYOf, tailSeatId };
