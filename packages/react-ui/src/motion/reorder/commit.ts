/** The flat-row drag commit (the motion view, pure framer Reorder over the
 * flat page sequence).
 *
 * The drag is framer's own reorder (the row's dragControls, the local
 * order state, the live reorder); the release commits it. The visible rows
 * are the entry root's SCOPE in its sequence container: for a
 * sequence-container entry root (the document root — the common case) the
 * container's full sequence; for a page-block entry root (a subtree
 * provider, e.g. a sync-embed subtree) the entry root's derived segment
 * within the container's sequence — the final VISIBLE order (the local
 * order at release — the collapsed segments and the surfaces (the canvas
 * layer — the page view filters them out of the page sequence) do not
 * participate) is a permutation of the segment's visible blocks. The
 * visible order is mapped back to the scope (a collapsed item's hidden
 * segment rows reinsert after their collapsed item, a surface stands at
 * its scope slot — a page gesture does not reorder the canvas layer), and
 * the commit is the range
 * move of the dragged block's derived subtree within the CONTAINER's
 * sequence (a range operation on one array, the scope's indices translated
 * by the scope's offset) plus the seam's indent assignment (below): one
 * transact, one undo step, one wire update. A no-op drop (the segment
 * landed at its own position) and a stale drop (a remote update changed
 * the scope mid-drag — the derived final order is not the current scope
 * with the segment moved) issue no command; so does a landing the core
 * rejects with its typed indent-jump violation (the move is the stale
 * drop's posture: no command, the order resyncs to the store).
 *
 * The seam's indent (the drop's two-variant rule): a drop at the seam
 * between the row A (the block before the landed span) and the row B (the
 * block after it) stands the segment's head at the seam's candidate
 * indent — the row the pointer stands over (its upper or lower half is
 * the same seam's side: the head lands before B at B's level, or after A
 * at A's level); in the gap between A and B the pointer's half decides
 * (the upper half stands the head before B — B's indent — the lower half
 * after A — A's indent); at the sequence's start the only candidate is
 * the first block's indent, at the end the last block's. The block's own
 * current indent is NOT a candidate for a real move (a no-op drop keeps
 * it — the position stands). The head's derived segment shifts by the
 * delta (candidate minus the head's current indent) uniformly, so the
 * segment's relative structure stands. */
import { commitFlatDrag } from "./flat-commit";
import { clampTailSeatCrossing, hiddenSegmentRows, indentOf, sameIds } from "./geometry";

export { clampTailSeatCrossing, commitFlatDrag, hiddenSegmentRows, indentOf, sameIds };
