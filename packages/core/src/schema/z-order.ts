/**
 * Normalization of the canvas z-order over a JSON snapshot. The surface's
 * children order is the single source of the z-order; each canvas element's
 * `zIndex` attr is a derived dense 1..N mirror (1 = bottom). A concurrent
 * insert into the same surface leaves the mirror stale (each peer wrote its
 * own local position, so two elements can both stand at 1); this helper
 * re-derives the dense index from the (converged) children order so the
 * snapshot is valid again.
 *
 * Per surface, all-or-nothing (the validator's invariant): when any canvas
 * element carries a `zIndex`, every canvas element's `zIndex` is re-derived
 * to its dense position among the surface's canvas elements. A surface with
 * no `zIndex` at all is the legacy form and is left untouched (the lenient
 * read derives the position from the children order).
 *
 * Pure JSON → JSON (no CRDT); idempotent and byte-stable on a dense input.
 * Unchanged entries share their object with the input; the document and the
 * rewritten entries are new.
 */
import type { DocJSON } from "./types";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The canvas element types that carry the explicit z-order `zIndex`. */
export const CANVAS_ZORDER_TYPES: ReadonlySet<string> = new Set(["shape", "connector", "canvas-text", "group"]);

function normalizeZOrder(json: DocJSON): DocJSON {
  const source = json.blocks as unknown as Record<string, Record<string, unknown>>;
  const blocks: Record<string, unknown> = { ...source };
  let changed = false;
  for (const block of Object.values(source)) {
    if (!isPlainObject(block) || block.type !== "surface" || !Array.isArray(block.children)) continue;
    const canvasChildren: string[] = [];
    for (const childId of block.children) {
      if (typeof childId !== "string") continue;
      const child = source[childId];
      if (
        child !== undefined &&
        isPlainObject(child) &&
        typeof child.type === "string" &&
        CANVAS_ZORDER_TYPES.has(child.type)
      ) {
        canvasChildren.push(childId);
      }
    }
    if (canvasChildren.length === 0) continue;
    const hasZIndex = canvasChildren.some((childId) => {
      const child = source[childId];
      return (
        child !== undefined &&
        isPlainObject(child.attrs) &&
        (child.attrs as Record<string, unknown>).zIndex !== undefined
      );
    });
    if (!hasZIndex) continue; // the legacy form (no index) — the lenient read derives it
    canvasChildren.forEach((childId, i) => {
      const child = source[childId];
      if (child === undefined) return;
      const attrs = isPlainObject(child.attrs) ? (child.attrs as Record<string, unknown>) : {};
      if (attrs.zIndex === i + 1) return; // already dense — share the entry
      blocks[childId] = { ...child, attrs: { ...attrs, zIndex: i + 1 } };
      changed = true;
    });
  }
  return changed ? ({ ...json, blocks } as DocJSON) : json;
}

export { normalizeZOrder };
