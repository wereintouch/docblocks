/** The canvas auto-membership: a created or pasted figure (a shape / a
 * canvas-text) whose CENTRE stands inside a container's box joins the
 * TOP-MOST such container (the paint order: the surface's order, then the
 * children's) and leaves every earlier owner — the move's join/leave's
 * parity, so a figure never stands in two containers. The containers are the
 * groups that existed before the write (the caller excludes the pasted
 * fragment's own groups). The reads and writes stand in the caller's
 * transaction, so the insert and the membership are one undo step. */
import type { BlockId, Doc } from "docblocks-core";

import { boxContains, effectiveGeometry } from "./geometry";

/** A zero-size box at the figure's centre (the containment read's stand). */
const CENTRE_SIZE = 0;

function autoMembership(doc: Doc, id: BlockId, exclude?: ReadonlySet<BlockId>): void {
  const block = doc.getBlock(id);
  if (block === null || (block.type !== "shape" && block.type !== "canvas-text")) return;
  const box = effectiveGeometry(block);
  const centre = { x: box.x, y: box.y, w: CENTRE_SIZE, h: CENTRE_SIZE };
  let home: BlockId | null = null;
  const owners: BlockId[] = [];
  let z = 0;
  let homeZ = -1;
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface === null || surface.type !== "surface") continue;
    for (const childId of doc.getChildren(surfaceId)) {
      z += 1;
      const child = doc.getBlock(childId);
      if (child === null || child.type !== "group") continue;
      if (child.attrs.members.includes(id)) owners.push(childId);
      if (exclude?.has(childId) === true) continue;
      if (z > homeZ && boxContains(centre, effectiveGeometry(child))) {
        home = childId;
        homeZ = z;
      }
    }
  }
  // The leave: every earlier owner except the new home.
  for (const ownerId of owners) {
    if (ownerId === home) continue;
    const owner = doc.getBlock(ownerId);
    if (owner === null || owner.type !== "group") continue;
    doc.updateBlock(ownerId, { members: owner.attrs.members.filter((memberId) => memberId !== id) });
  }
  if (home === null) return;
  const target = doc.getBlock(home);
  if (target === null || target.type !== "group") return;
  if (target.attrs.members.includes(id)) return;
  doc.updateBlock(home, { members: [...target.attrs.members, id] });
}

export { autoMembership };
