/**
 * The canvas geometry command: setGeometry. The geometry is a block field
 * (not an attr), so it has its own command instead of going through
 * updateBlock. A command validates first (typed errors, no silent no-ops)
 * and then mutates in one transaction with the local origin.
 */
import * as Y from "yjs";

import type { Geometry } from "@docblocks-core/schema";

import { InvalidGeometryError, UnknownBlockError } from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, getBlockMap } from "./structure";

/** The block's stored geometry as plain numbers; null when absent or corrupt. */
function readGeometry(block: Y.Map<unknown>): Geometry | null {
  const geometry = block.get("geometry");
  if (!(geometry instanceof Y.Map)) return null;
  const plain: Record<string, number> = {};
  geometry.forEach((value, key) => {
    if (typeof value === "number") plain[key] = value;
  });
  const { x, y, w, h } = plain;
  if (x === undefined || y === undefined || w === undefined || h === undefined) return null;
  return { x, y, w, h };
}

/**
 * Sets the canvas geometry of a block: a partial patch MERGES with the
 * existing geometry and the result must be complete (x/y/w/h all present
 * — a partial on a block without a geometry is an error), `null` removes
 * the geometry (the block returns to the flow / the default canvas
 * position). Patch values are validated (finite x/y, w/h > 0); a patch
 * carrying the `rotation` key is rejected. An equal-value set is a no-op
 * (zero update bytes).
 */
function setGeometry(ydoc: Y.Doc, blockId: string, geometry: Partial<Geometry> | null): void {
  const type = blockTypeOf(ydoc, blockId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);
  // The group carries its OWN geometry (the container's free box): the
  // container stands its own box — the members'
  // absolute coordinates stand (the group-move batch moves the box and the
  // members by one delta).
  const block = getBlockMap(ydoc, blockId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);

  if (geometry === null) {
    if (readGeometry(block) === null) return; // no-op: there is no geometry to remove
    localTransact(ydoc, () => block.delete("geometry"));
    return;
  }

  // The geometry shape has no rotation field: a patch carrying it is
  // rejected explicitly (the legacy data keeps the field — the data is
  // never rewritten).
  if ((geometry as Record<string, unknown>).rotation !== undefined) {
    throw new InvalidGeometryError(`Unknown field "rotation" for geometry.`);
  }

  for (const [key, value] of Object.entries(geometry)) {
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new InvalidGeometryError(`geometry.${key} must be a finite number (got ${value}).`);
    }
    if ((key === "w" || key === "h") && value <= 0) {
      throw new InvalidGeometryError(`geometry.${key} must be positive (got ${value}).`);
    }
  }

  const current = readGeometry(block);
  const mergedX = geometry.x ?? current?.x;
  const mergedY = geometry.y ?? current?.y;
  const mergedW = geometry.w ?? current?.w;
  const mergedH = geometry.h ?? current?.h;
  if (mergedX === undefined || mergedY === undefined || mergedW === undefined || mergedH === undefined) {
    throw new InvalidGeometryError(
      `Incomplete geometry: x, y, w and h are required — block "${blockId}" has no existing geometry to merge into.`
    );
  }

  if (
    current !== null &&
    current.x === mergedX &&
    current.y === mergedY &&
    current.w === mergedW &&
    current.h === mergedH
  ) {
    return; // no-op: an equal-value set emits no update
  }

  localTransact(ydoc, () => {
    // The nested map is single-authored (created with the block): update the
    // existing one in place, create it when the block had no geometry.
    const existing = block.get("geometry");
    const map: Y.Map<unknown> = existing instanceof Y.Map ? existing : new Y.Map<unknown>();
    if (!(existing instanceof Y.Map)) block.set("geometry", map);
    map.set("x", mergedX);
    map.set("y", mergedY);
    map.set("w", mergedW);
    map.set("h", mergedH);
  });
}

export { setGeometry };
