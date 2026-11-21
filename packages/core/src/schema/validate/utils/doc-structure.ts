/**
 * The document's structural validation passes: the surface's z-order, the
 * flat page sequences' indent-jump rule, the frame's context rules, the
 * root's reachability (the orphan report), and the opaque (unknown-type)
 * block's structural checks. Run from validateDoc.
 */
import type { BlockType } from "../../block-union";
import { BLOCK_REGISTRY } from "../../registry";
import { indentOf } from "../../utils";
import { CANVAS_ZORDER_TYPES } from "../../z-order";
import type { ValidationError } from "../models";
import { validateGeometry } from "./blocks";
import { isPlainObject, show } from "./common";

/**
 * The surface's explicit z-order invariant: the canvas elements
 * (shape / connector / canvas-text / group / frame) carry a `zIndex` attr
 * that is the element's position among the surface's canvas elements (dense
 * 1..N, the children order's mirror — 1 = bottom). The invariant is
 * all-or-nothing per surface: if any canvas element carries a `zIndex`, all
 * of them must, and the set must be the dense 1..N sequence. A surface with
 * no `zIndex` at all is the legacy form (the lenient reader derives it from
 * the children position).
 */
function validateSurfaceZOrder(blocks: Record<string, unknown>, errors: ValidationError[]): void {
  for (const [, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "surface") continue;
    if (!Array.isArray(block.children)) continue; // a missing order is reported above
    const canvasChildren: string[] = [];
    for (const childId of block.children) {
      if (typeof childId !== "string" || !(childId in blocks)) continue; // reported above
      const child = blocks[childId];
      if (!isPlainObject(child) || typeof child.type !== "string") continue;
      if (CANVAS_ZORDER_TYPES.has(child.type as string)) canvasChildren.push(childId);
    }
    if (canvasChildren.length === 0) continue;
    const hasZIndex = canvasChildren.some((childId) => {
      const attrs = (blocks[childId] as Record<string, unknown>).attrs;
      return isPlainObject(attrs) && (attrs as Record<string, unknown>).zIndex !== undefined;
    });
    if (!hasZIndex) continue; // the legacy form (no index) — the lenient reader derives it
    canvasChildren.forEach((childId, i) => {
      const child = blocks[childId] as Record<string, unknown>;
      const attrs = isPlainObject(child.attrs) ? (child.attrs as Record<string, unknown>) : undefined;
      const zIndex = attrs?.zIndex;
      const path = `blocks.${childId}.attrs.zIndex`;
      if (zIndex === undefined) {
        errors.push({
          path,
          message: `A surface's canvas elements must all carry a zIndex (or none); "${childId}" is missing it.`,
        });
        return;
      }
      if (typeof zIndex !== "number" || !Number.isInteger(zIndex) || zIndex < 1) {
        errors.push({ path, message: `The zIndex must be a positive integer (got ${show(zIndex)}).` });
        return;
      }
      if (zIndex !== i + 1) {
        errors.push({
          path,
          message: `The zIndex must be the element's position among the surface's canvas elements (dense 1..N); "${childId}" stands ${zIndex}, expected ${i + 1}.`,
        });
      }
    });
  }
}

/**
 * The indent-jump rule of a flat page sequence: a block's indent may
 * exceed the preceding block's indent by at most 1 (the first block anchors
 * at 0 — there is no block to attach to). Runs per sequence container
 * (registry `sequence` flag: root, table-cell); structural order
 * (table-row grid, surface z-order) ignores indent.
 */
function validateSequences(blocks: Record<string, unknown>, errors: ValidationError[]): void {
  for (const block of Object.values(blocks)) {
    if (!isPlainObject(block)) continue;
    const type = block.type;
    if (typeof type !== "string" || !Object.hasOwn(BLOCK_REGISTRY, type) || !BLOCK_REGISTRY[type as BlockType].sequence)
      continue;
    if (!Array.isArray(block.children)) continue; // a missing/non-array order is reported above
    let prev = -1; // virtual: before the first block
    block.children.forEach((childId, index) => {
      if (typeof childId !== "string" || !(childId in blocks)) return; // reported above
      const child = blocks[childId];
      if (!isPlainObject(child)) return;
      const indent = indentOf(child);
      if (index === 0 && indent > 0) {
        errors.push({
          path: `blocks.${childId}.attrs.indent`,
          message: `The first block of a page sequence must have indent 0 (got ${indent}).`,
        });
      } else if (indent > prev + 1) {
        errors.push({
          path: `blocks.${childId}.attrs.indent`,
          message: `Attribute "indent" must not exceed the preceding block's indent (${prev}) by more than 1 (got ${indent}).`,
        });
      }
      prev = indent;
    });
  }
}

/**
 * The frame's context rules (two contexts, one type): in the root's
 * children the frame is the PAGE-FRAME block — the inline window into a
 * canvas frame — so `attrs.frameId` (the non-empty weak reference) is
 * required and `attrs.title` is forbidden (the label stands on the canvas
 * frame); in a surface's children it is the CANVAS FRAME — `attrs.frameId`
 * is forbidden and `attrs.title` stands the label. The non-empty / string
 * value rules of `frameId` stand on the registry's attrs spec; the context
 * rules judge the presence. A frame whose parent is neither the root nor a
 * surface stands no context (the child-type / reachability rules report
 * it). Runs from validateDoc, both postures.
 */
function validateFrameContext(
  blocks: Record<string, unknown>,
  firstParent: Map<string, { parentId: string; path: string }>,
  errors: ValidationError[]
): void {
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "frame") continue;
    const reference = firstParent.get(id);
    if (reference === undefined) continue; // a missing or multiple parent is reported above
    const parent = blocks[reference.parentId];
    if (!isPlainObject(parent) || typeof parent.type !== "string") continue;
    const attrs = isPlainObject(block.attrs) ? (block.attrs as Record<string, unknown>) : {};
    if (parent.type === "root") {
      if (!("frameId" in attrs)) {
        errors.push({
          path: `blocks.${id}.attrs.frameId`,
          message: `A frame in the root's children (the page-frame block) requires a non-empty "frameId" (a reference to a canvas frame).`,
        });
      }
      if ("title" in attrs) {
        errors.push({
          path: `blocks.${id}.attrs.title`,
          message: `A frame in the root's children (the page-frame block) must not carry a "title" (the label stands on the canvas frame).`,
        });
      }
    } else if (parent.type === "surface") {
      if ("frameId" in attrs) {
        errors.push({
          path: `blocks.${id}.attrs.frameId`,
          message: `A frame in a surface's children (the canvas frame) must not carry a "frameId" (the reference stands on the page-frame block in the root).`,
        });
      }
    }
  }
}

/**
 * The root's reachability: every block except the root must be reachable
 * from the root. The lenient posture skips the check: the unreferenced
 * entry is preserved data (the legacy frame's dropped children, a
 * cross-minor addition) — the read path never surfaces it, the strict
 * posture flags it.
 */
function validateReachability(
  blocks: Record<string, unknown>,
  rootId: string,
  lenient: boolean,
  errors: ValidationError[]
): void {
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    const block = blocks[id];
    if (!isPlainObject(block) || !Array.isArray(block.children)) continue;
    for (const childId of block.children) {
      if (typeof childId === "string" && childId in blocks && !visited.has(childId)) {
        visited.add(childId);
        queue.push(childId);
      }
    }
  }
  for (const id of Object.keys(blocks)) {
    if (id !== rootId && !visited.has(id) && !lenient) {
      errors.push({ path: `blocks.${id}`, message: `Orphan block "${id}" (unreachable from root).` });
    }
  }
}

/**
 * The structural checks of an unknown-type block in the lenient (cross-minor)
 * load: the entry is preserved as opaque data (its fields stand as-is), so
 * only the invariants that keep the read path and the reachability sound are
 * checked — the children id array (the structural order) and the geometry.
 * The per-type rules (attrs, content, rows) are skipped: the engine does not
 * know the type's contract.
 */
function validateOpaqueStructure(
  id: string,
  block: Record<string, unknown>,
  blocks: Record<string, unknown>,
  firstParent: Map<string, { parentId: string; path: string }>,
  referenceCount: Map<string, number>,
  errors: ValidationError[]
): void {
  if ("children" in block) {
    if (!Array.isArray(block.children)) {
      errors.push({
        path: `blocks.${id}.children`,
        message: `children must be an array of block ids (got ${show(block.children)}).`,
      });
      return;
    }
    block.children.forEach((childId, index) => {
      const childPath = `blocks.${id}.children[${index}]`;
      if (typeof childId !== "string") {
        errors.push({ path: childPath, message: `A child id must be a string (got ${show(childId)}).` });
        return;
      }
      if (childId === id) {
        errors.push({ path: childPath, message: `Block "${id}" cannot be its own child.` });
      }
      if (!(childId in blocks)) {
        errors.push({ path: childPath, message: `Dangling child id "${childId}" (no such block).` });
        return;
      }
      const first = firstParent.get(childId);
      referenceCount.set(childId, (referenceCount.get(childId) ?? 0) + 1);
      if (first) {
        errors.push({
          path: childPath,
          message: `Block "${childId}" is referenced more than once (already a child of "${first.parentId}" at ${first.path}).`,
        });
      } else {
        firstParent.set(childId, { parentId: id, path: childPath });
      }
    });
  }
  if ("geometry" in block) validateGeometry(block.geometry, `blocks.${id}.geometry`, errors, true);
}

export {
  validateFrameContext,
  validateOpaqueStructure,
  validateReachability,
  validateSequences,
  validateSurfaceZOrder,
};
