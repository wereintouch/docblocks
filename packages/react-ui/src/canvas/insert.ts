import type { BlockId, Doc, ShapeAttrs } from "docblocks-core";
import { InvalidOperationError } from "docblocks-core";

import type { CanvasPoint, PenStroke } from "./viewport";

/** The shape's variant (the dock's shape tools; the pen reuses the rect variant — its points win in the render). */
type ShapeVariant = "rect" | "rounded" | "ellipse" | "diamond" | "cylinder" | "cloud";

/**
 * The placement commands (the dock's tools): one `doc.transact` per placed
 * block — the insert plus the `setGeometry` (one undo step, one wire
 * update). The target is the FIRST surface in the root's child order
 * (created in the same transaction when the document has none); the
 * center anchor lands at the placement point.
 */

/** The first surface (root order); created in `doc.transact` when absent. */
export function firstSurface(doc: Doc): BlockId {
  for (const id of doc.getChildren(doc.meta.id)) {
    if (doc.getBlock(id)?.type === "surface") return id;
  }
  let created: BlockId | null = null;
  doc.transact(() => {
    created = doc.insertBlock("surface");
  });
  return created!;
}

/**
 * A placed shape (rect / rounded / ellipse / diamond / cylinder / cloud)
 * at the point. Returns the new block id.
 */
export function placeShape(
  doc: Doc,
  variant: ShapeVariant,
  point: CanvasPoint,
  size: { w: number; h: number }
): BlockId {
  const surface = firstSurface(doc);
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("shape", { variant } satisfies ShapeAttrs, { parent: surface });
    doc.setGeometry(id, { x: point.x, y: point.y, w: size.w, h: size.h });
  });
  return id!;
}

/**
 * A placed canvas-text at the point. Returns the new block id.
 */
export function placeCanvasText(doc: Doc, point: CanvasPoint, size: { w: number; h: number }): BlockId {
  const surface = firstSurface(doc);
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("canvas-text", undefined, { parent: surface });
    doc.setGeometry(id, { x: point.x, y: point.y, w: size.w, h: size.h });
  });
  return id!;
}

/**
 * A placed frame at the point, with a starter paragraph inside (an empty
 * frame has no block to seat the caret on). Returns the new frame id.
 */
export function placeFrame(doc: Doc, point: CanvasPoint, size: { w: number; h: number }): BlockId {
  const surface = firstSurface(doc);
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("frame", undefined, { parent: surface });
    doc.setGeometry(id, { x: point.x, y: point.y, w: size.w, h: size.h });
    doc.insertBlock("paragraph", undefined, { parent: id });
  });
  return id!;
}

/**
 * A placed container (the reworked group):
 * an empty group (no members yet — the figures are dragged into it) with
 * its own free box. Returns the new group id.
 */
export function placeContainer(doc: Doc, point: CanvasPoint, size: { w: number; h: number }): BlockId {
  const surface = firstSurface(doc);
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("group", { members: [] }, { parent: surface });
    doc.setGeometry(id, { x: point.x, y: point.y, w: size.w, h: size.h });
  });
  return id!;
}

/**
 * A placed connector between two canvas items of the same surface (the
 * endpoint refs; no own geometry — the overlay resolves the edge anchors).
 * Returns the new block id. Throws (and the transaction rolls back) when
 * the endpoints are not siblings of one surface.
 */
export function placeConnector(doc: Doc, startId: BlockId, endId: BlockId): BlockId {
  const surface = findParentSurface(doc, startId);
  if (surface === null || findParentSurface(doc, endId) !== surface) {
    throw new InvalidOperationError("The connector's endpoints must be canvas items of the same surface.");
  }
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("connector", { start: { blockId: startId }, end: { blockId: endId } }, { parent: surface });
  });
  return id!;
}

/**
 * A placed pen stroke: the shape's points (the block-local stroke) + the
 * bbox geometry. Returns the new block id.
 */
export function placePenStroke(doc: Doc, stroke: PenStroke): BlockId {
  const surface = firstSurface(doc);
  let id: BlockId | null = null;
  doc.transact(() => {
    id = doc.insertBlock("shape", { variant: "rect", points: stroke.points } satisfies ShapeAttrs, { parent: surface });
    doc.setGeometry(id, stroke.geometry);
  });
  return id!;
}

/** The parent surface's id of a canvas item (null when not a surface child). */
export function findParentSurface(doc: Doc, id: BlockId): BlockId | null {
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface?.type !== "surface") continue;
    if (doc.getChildren(surfaceId).includes(id)) return surfaceId;
  }
  return null;
}

/**
 * The group creation: the selected canvas
 * items stand the new group's members in ONE transact (one undo step, one
 * wire update). Returns the new group id, or null for the ineligible
 * selection (one member, a connector / a group in the set, a page block,
 * or the members across surfaces — the group is a flat marker over its
 * siblings, never a container). No throw: the hotkey's no-op posture.
 */
export function makeGroup(doc: Doc, ids: readonly BlockId[]): BlockId | null {
  if (ids.length < 2) return null;
  let surface: BlockId | null = null;
  for (const id of ids) {
    const block = doc.getBlock(id);
    if (block === null || block.type === "connector" || block.type === "group") return null;
    const owner = findParentSurface(doc, id);
    if (owner === null) return null; // a page block (no surface)
    if (surface === null) surface = owner;
    else if (owner !== surface) return null;
  }
  let created: BlockId | null = null;
  doc.transact(() => {
    created = doc.insertBlock("group", { members: [...ids] }, { parent: surface! });
  });
  return created;
}

/**
 * The group's dissolve (the Delete / the ungroup hotkey's path): the
 * group entry goes, the members stand where they are (the marker is not
 * a container — no cascade). Returns false for the non-group id (the
 * caller's delete path owns it).
 */
export function dissolveGroup(doc: Doc, id: BlockId): boolean {
  const block = doc.getBlock(id);
  if (block === null || block.type !== "group") return false;
  doc.removeBlock(id);
  return true;
}
