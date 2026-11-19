/** The drill-up's parent read: the container a member leaves to — the group
 * that lists the block, the TOP-most by the paint order (the surface's root
 * order, then the children's order), the innermost (the smallest box) over a
 * tie. A block may stand in several containers (the group creation keeps the
 * earlier membership): the paint order decides, so the result is
 * deterministic. Pure doc read — no update. */
import type { Block, BlockId, Doc } from "docblocks-core";

import { effectiveGeometry } from "../geometry";

interface OwnerCandidate {
  id: BlockId;
  z: number;
  area: number;
}

/** The containers that list the block, in the paint order. */
function containerOwnersOf(doc: Doc, memberId: BlockId): OwnerCandidate[] {
  const owners: OwnerCandidate[] = [];
  let z = 0;
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of doc.getChildren(surfaceId)) {
      z += 1;
      const child: Block | null = doc.getBlock(childId);
      if (child === null || child.type !== "group") continue;
      if (!child.attrs.members.includes(memberId)) continue;
      const box = effectiveGeometry(child);
      owners.push({ id: childId, z, area: box.w * box.h });
    }
  }
  return owners;
}

/** The block's parent container for the drill-up (null over no owner). */
function parentContainerOf(doc: Doc, memberId: BlockId): BlockId | null {
  const owners = containerOwnersOf(doc, memberId);
  if (owners.length === 0) return null;
  const [top] = [...owners].sort((a, b) => b.z - a.z || a.area - b.area);
  return top?.id ?? null;
}

export { containerOwnersOf, parentContainerOf };
