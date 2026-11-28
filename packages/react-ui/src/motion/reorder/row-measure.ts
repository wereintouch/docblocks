/** The drag's seam candidate over the visible rows' settled viewport
 * boxes (the preview's and the release's shared measurement): the
 * rows' collection + the seam rule's resolution. */
import type { BlockId, Doc } from "docblocks-core";

import { entrySequenceParent } from "../../blocks";
import type { FlatNode } from "../../blocks";
import { segmentRange } from "../../editing/block-commands";
import type { DropRow } from "./models";
import { dropCandidateIndent } from "./seam";

/**
 * The seam candidate at the pointer's Y (the drag's live preview and
 * the release's commit input share it): the visible rows' viewport
 * boxes against the seam rule (`reorder.ts`). Null when the measurement
 * is stale (the segment vanished, or the rows are gone) — the caller
 * keeps the preview (move) or skips the commit (release, the
 * render-phase resync snaps the order back to the store).
 */
function measureSeamCandidate(
  root: HTMLDivElement,
  session: { rootBlockId: BlockId; value: BlockId } | null,
  doc: Doc,
  rootBlockId: BlockId,
  nodesById: Map<string, FlatNode>,
  id: BlockId,
  pointerY: number
): number | null {
  const containerId =
    session !== null && session.rootBlockId === rootBlockId ? session.value : entrySequenceParent(doc, rootBlockId);
  const segment = segmentRange(doc, containerId, id);
  if (segment === null) return null;
  const segmentIds = new Set(doc.getChildren(containerId).slice(segment.start, segment.end));
  const rows: DropRow[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-slot="docblocks/row"]'))) {
    // The row's block id stands on its direct child (the block wrapper —
    // the descendant query stands the wrapper's own attribute over the
    // row's row-level anchor).
    const wrapperId = el.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? null;
    if (wrapperId === null) continue;
    const node = nodesById.get(wrapperId);
    if (node === undefined) continue;
    // The row's SETTLED box: the static layout (the offsetTop chain —
    // transform-blind), not the live one. The rows slide on the layout
    // projection while a drag runs, and the live boxes would stand
    // mid-slide at the release (a stale seam measurement). The chain
    // assumes no positioned/fixed ancestor above the editor (a
    // position: fixed embedding would offset every box by a constant —
    // the commit's guards keep such a measurement from committing a
    // wrong seam).
    let top = 0;
    for (
      let ancestor: HTMLElement | null = el;
      ancestor !== null;
      ancestor = ancestor.offsetParent as HTMLElement | null
    ) {
      top += ancestor.offsetTop;
    }
    top -= window.scrollY;
    rows.push({ id: wrapperId, top, bottom: top + el.offsetHeight, indent: node.indent });
  }
  if (rows.length === 0) return null;
  return dropCandidateIndent(rows, pointerY, segmentIds, id);
}

export { measureSeamCandidate };
