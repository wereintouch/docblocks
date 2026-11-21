/** The flat-row drag commit's geometry helpers (the sequence's
 * offset/indent math): the same-ids check, the block's effective
 * indent, the collapsed item's hidden segment rows, and the tail
 * seat's clamp (the preview side of the commit's tail landing). */
import type { BlockId, Doc } from "docblocks-core";

/** Same ids in the same order (order matters). */
function sameIds(a: readonly BlockId[], b: readonly BlockId[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** The block's effective indent (absent is 0). */
function indentOf(doc: Doc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" && Number.isInteger(indent) && indent >= 0 ? indent : 0;
}

/**
 * A collapsed list item's hidden segment rows (in scope order): the
 * contiguous stretch after the item with `indent` deeper than the item's
 * own, up to the first block with `indent` <= the item's (the segment
 * minus the item itself). Absent when the item is not in the scope. The
 * scope is a superset of the item's segment (its followers are deeper than
 * the item, hence inside the scope), so the scoped scan equals the
 * full-sequence one.
 */
function hiddenSegmentRows(doc: Doc, sequence: readonly BlockId[], itemId: BlockId): BlockId[] {
  const start = sequence.indexOf(itemId);
  if (start === -1) return [];
  const indent = indentOf(doc, itemId);
  const rows: BlockId[] = [];
  for (let i = start + 1; i < sequence.length; i += 1) {
    const id = sequence[i];
    if (id === undefined) break;
    if (indentOf(doc, id) <= indent) break;
    rows.push(id);
  }
  return rows;
}

/**
 * The tail seat's clamp (the preview side of the commit's tail landing):
 * framer's own reorder lets the dragged row cross the full-doc root's
 * trailing text paragraph (the pointer beyond the last row stands it
 * last). The commit stands the segment above the seat (the doc's tail
 * contract), so the preview stands the crossing too — the dragged row
 * clamps to the seat's slot, and the release settles at the preview's
 * stand. The seat's own drag stands unclamped (it is a real block — the
 * guarantee stands its own stand on release).
 */
function clampTailSeatCrossing(next: readonly BlockId[], draggedId: BlockId, seatId: BlockId | undefined): BlockId[] {
  if (seatId === undefined || draggedId === seatId) return [...next];
  const draggedAt = next.indexOf(draggedId);
  const seatAt = next.indexOf(seatId);
  if (draggedAt < 0 || seatAt < 0 || draggedAt <= seatAt) return [...next];
  const rest = next.filter((id) => id !== draggedId);
  const seatAfter = rest.indexOf(seatId);
  return [...rest.slice(0, seatAfter), draggedId, ...rest.slice(seatAfter)];
}

export { clampTailSeatCrossing, hiddenSegmentRows, indentOf, sameIds };
