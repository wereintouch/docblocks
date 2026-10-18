import type { BlockId, Doc, ShapeAttrs } from "docblocks-core";
import { InvalidOperationError } from "docblocks-core";

import type { CanvasPoint, PenStroke } from "./viewport";

/** The shape's variant (the dock's shape tools; the pen reuses the rect variant — its points win in the render). */
type ShapeVariant = "rect" | "ellipse" | "diamond" | "line";

/**
 * The placement commands (the dock's tools): one `doc.transact` per placed
 * block — the insert plus the `setGeometry` (one undo step, one wire
 * update). The target is the FIRST surface in the root's child order
 * (created in the same transaction when the document has none); the
 * center anchor lands at the placement point.
 */

/** The first surface (root order); created in `doc.transact` when absent. */
function firstSurface(doc: Doc): BlockId {
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
 * A placed shape (rect / ellipse / diamond / line) at the point. Returns
 * the new block id.
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
function findParentSurface(doc: Doc, id: BlockId): BlockId | null {
  for (const surfaceId of doc.getChildren(doc.meta.id)) {
    const surface = doc.getBlock(surfaceId);
    if (surface?.type !== "surface") continue;
    if (doc.getChildren(surfaceId).includes(id)) return surfaceId;
  }
  return null;
}
