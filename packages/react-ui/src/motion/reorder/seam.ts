/** The drop's candidate indent (the module header's seam rule), from the
 * pointer's Y and the visible rows' settled boxes (viewport coordinates).
 * The seam stands against the rows that STAND (the dragged segment's rows
 * are the drop's moving span — the seam's neighbors, but they still occupy
 * the span's space in the settled layout): over a row that stands — that
 * row's indent (the pointer's half inside the row is the seam's side, but
 * both sides stand the head at the row's level); in a gap — the gap's
 * halves, split by the pointer's local gap's middle (the nearest rows
 * above and below the pointer — the span's own settled slots included, so
 * the middle splits the gap the pointer stands in, not the span's whole
 * span) — the upper stands the head before the row below, the lower after
 * the row above, at that row's level; above every row — the seam at the
 * sequence's start, the first standing row's indent; below the last — the
 * last standing row's. A local row that is the span's own slot carries no
 * seam information at the sequence's ends (the no-op or a stale drop —
 * the commit's guards stand): the value stands from the standing rows. */
import type { BlockId } from "docblocks-core";

import type { DropRow } from "./models";

function dropCandidateIndent(
  rows: readonly DropRow[],
  pointerY: number,
  segmentIds: ReadonlySet<BlockId>,
  headId: BlockId
): number {
  const rest = rows.filter((row) => !segmentIds.has(row.id));
  if (rest.length === 0) {
    const head = rows.find((row) => row.id === headId);
    return head === undefined ? 0 : head.indent;
  }
  // Over a standing row: both halves of the row stand the head at its level.
  const over = rest.find((row) => pointerY >= row.top && pointerY < row.bottom);
  if (over !== undefined) return over.indent;
  // The pointer stands in a gap (or beyond the rows' ends). The nearest
  // rows by coordinate — the full visible set, the span's own settled slots
  // included — on either side of the pointer; the pointer's gap's middle
  // splits the halves.
  const belowLocal = rows.find((row) => row.top >= pointerY);
  const aboveLocal = [...rows].reverse().find((row) => row.bottom <= pointerY);
  if (belowLocal !== undefined && aboveLocal !== undefined) {
    const mid = (aboveLocal.bottom + belowLocal.top) / 2;
    const seamRow = pointerY < mid ? belowLocal : aboveLocal;
    return seamRow.indent;
  }
  // Beyond the rows' ends: the seam stands at the sequence's edge — the
  // first/last standing row (the edge row is the span's own slot only for
  // a no-op or a stale drop — the commit's guards stand, the candidate is
  // unused).
  if (belowLocal !== undefined) {
    return segmentIds.has(belowLocal.id) ? (rest[0]?.indent ?? 0) : belowLocal.indent;
  }
  const last = aboveLocal?.indent ?? 0;
  return aboveLocal !== undefined && segmentIds.has(aboveLocal.id) ? (rest[rest.length - 1]?.indent ?? 0) : last;
}

export { dropCandidateIndent };
