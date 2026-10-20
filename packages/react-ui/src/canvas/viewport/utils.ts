/** The canvas viewport's pure helpers: the endpoint drag's port snap (the
 *  nearest edge midpoint of a surface sibling within the snap radius,
 *  excluding the dragged endpoint's own anchor). */
import type { Block, Doc } from "docblocks-core";

import { effectiveGeometry, endpointPointOf, portOfNormal, portsOf } from "../../blocks/canvas-geometry";
import type { CanvasPort } from "../../blocks/canvas-geometry";
import type { CanvasPoint } from "../viewport";
import { ENDPOINT_SNAP_RADIUS } from "./models";
import type { EndpointSnap } from "./models";

/** The port snap: the nearest edge midpoint of a surface sibling within the
 * snap radius (the canvas px, the zoom-blind space). The dragged endpoint's
 * CURRENT anchor (the exact block + port pair it stands — the legacy ref's
 * pair is the anchor edge's side) is excluded: the release on its own port
 * detaches to the free point (re-anchoring to the same port is a no-op).
 * The block's OTHER ports stand the re-anchor (the edge's side takes the
 * frozen direction over —). */
function snapEndpointPort(
  doc: Doc,
  surfaceId: string,
  connectorId: string,
  which: "start" | "end",
  point: CanvasPoint
): EndpointSnap | null {
  const block = doc.getBlock(connectorId);
  if (block === null || block.type !== "connector") return null;
  const ref = block.attrs[which];
  const children = doc.getChildren(surfaceId);
  // The current anchor (the stored attrs — the drag stands no doc write).
  let excluded: { blockId: string; port: CanvasPort } | null = null;
  if (ref.docId === undefined && ref.blockId !== undefined && ref.x === undefined && children.includes(ref.blockId)) {
    const blocks: Record<string, Block> = {};
    for (const childId of children) {
      const child = doc.getBlock(childId);
      if (child !== null) blocks[childId] = child;
    }
    const other = block.attrs[which === "start" ? "end" : "start"];
    const otherResolved = endpointPointOf(other, children, blocks, { x: 0, y: 0 });
    const toward = otherResolved !== null ? { x: otherResolved.x, y: otherResolved.y } : { x: 0, y: 0 };
    const resolved = endpointPointOf(ref, children, blocks, toward);
    const port = ref.port !== undefined ? ref.port : portOfNormal(resolved?.nx ?? 0, resolved?.ny ?? 0);
    if (port !== null) excluded = { blockId: ref.blockId, port };
  }
  let snap: EndpointSnap | null = null;
  let best = ENDPOINT_SNAP_RADIUS;
  for (const siblingId of children) {
    if (siblingId === connectorId) continue;
    const sibling = doc.getBlock(siblingId);
    if (sibling === null) continue;
    const ports = portsOf(effectiveGeometry(sibling));
    for (const port of ["north", "east", "south", "west"] as const) {
      if (excluded !== null && siblingId === excluded.blockId && port === excluded.port) continue;
      const p = ports[port];
      const dist = Math.hypot(p.x - point.x, p.y - point.y);
      if (dist < best) {
        best = dist;
        snap = { blockId: siblingId, port };
      }
    }
  }
  return snap;
}

export { snapEndpointPort };
