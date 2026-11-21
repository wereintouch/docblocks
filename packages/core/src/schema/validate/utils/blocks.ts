/**
 * The block-level strict checks over a block's plain JSON shape: the
 * `geometry` field (ANY block) and the canvas `shape` / `connector`
 * invariants. Run from validateDoc and from the command checks. The
 * database block's checks stand in database-contract (the cell value's
 * contract + the filter payload) and database-block (the rows / rowOrder
 * invariants).
 */
import type { BlockType } from "../../block-union";
import { GEOMETRY_FIELDS } from "../constants";
import type { ValidationError } from "../models";
import { isPlainObject, show } from "./common";

/**
 * The strict shape of the optional `geometry` field of ANY block: a plain
 * object with finite x/y and w/h > 0, where x/y/w/h are required and
 * unknown fields are rejected (the strict posture; the lenient cross-minor
 * load preserves an additive / legacy field as-is — the reader and the
 * renderer ignore it, and the writer keeps it). Runs from validateDoc for
 * every block that carries a geometry field.
 */
function validateGeometry(geometry: unknown, path: string, errors: ValidationError[], lenient = false): void {
  if (!isPlainObject(geometry)) {
    errors.push({ path, message: `geometry must be a plain object (got ${show(geometry)}).` });
    return;
  }
  for (const field of ["x", "y", "w", "h"] as const) {
    if (!(field in geometry)) {
      errors.push({ path: `${path}.${field}`, message: `Field "${field}" of geometry is required.` });
      continue;
    }
    const value = geometry[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push({
        path: `${path}.${field}`,
        message: `geometry.${field} must be a finite number (got ${show(value)}).`,
      });
      continue;
    }
    if ((field === "w" || field === "h") && value <= 0) {
      errors.push({ path: `${path}.${field}`, message: `geometry.${field} must be positive (got ${value}).` });
    }
  }
  for (const field of Object.keys(geometry)) {
    if ((GEOMETRY_FIELDS as readonly string[]).includes(field)) continue;
    // Lenient (cross-minor load): an additive or legacy field (a future
    // minor's data, the pre-release rotation stand) is preserved as-is.
    if (!lenient) errors.push({ path: `${path}.${field}`, message: `Unknown field "${field}" for geometry.` });
  }
}

/**
 * The canvas block-level invariants of `shape` / `connector` (strict),
 * over the block's plain JSON shape: the `points` attr is an array of
 * [x, y] pairs of finite numbers (a tuple shape the AttrSpec array kind
 * cannot express — the spec passes any array), and each connector
 * endpoint carries either a weak ref (at least one of docId / blockId,
 * with an optional port — the edge anchor) or a free point (both x and
 * y, finite — with an optional port, the FROZEN direction the line
 * leaves the point at — the last anchor's side, kept while the endpoint
 * stands off the blocks). The enums and the numeric kinds are checked by
 * the registry attrs spec. Runs from validateDoc, and from the
 * insertBlock / updateBlock command checks.
 */
function validateCanvasBlock(
  type: BlockType,
  block: Record<string, unknown>,
  path: string,
  errors: ValidationError[]
): void {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;

  if (attrs === undefined) return;

  const points = attrs.points;
  if (Array.isArray(points)) {
    points.forEach((item, index) => {
      const valid =
        Array.isArray(item) &&
        item.length === 2 &&
        item.every((coordinate) => typeof coordinate === "number" && Number.isFinite(coordinate));
      if (!valid) {
        errors.push({
          path: `${path}.attrs.points[${index}]`,
          message: `A points entry must be a [x, y] pair of finite numbers (got ${show(item)}).`,
        });
      }
    });
  }

  if (type === "connector") {
    for (const key of ["start", "end"] as const) {
      const ref = attrs[key];
      if (!isPlainObject(ref)) continue; // a malformed ref is reported by the object spec
      const isRef = "docId" in ref || "blockId" in ref;
      const isFree = "x" in ref || "y" in ref;
      if (!isRef && !isFree) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" must carry a block ref (docId / blockId) or a free point (x and y).`,
        });
        continue;
      }
      if (isFree && "x" in ref !== "y" in ref) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" free point: x and y must stand together.`,
        });
      }
      if ("port" in ref && !isRef && !("x" in ref && "y" in ref)) {
        errors.push({
          path: `${path}.attrs.${key}`,
          message: `Connector endpoint "${key}" port requires a block ref (docId / blockId) or a free point (x and y — the frozen direction).`,
        });
      }
      if ("portT" in ref) {
        // The edge anchor's fractional position : it stands on a BLOCK REF's port only (a free
        // point's port is the frozen direction — t stands no anchor
        // position there) and within the side's [0, 1].
        if (!isRef || !("port" in ref)) {
          errors.push({
            path: `${path}.attrs.${key}`,
            message: `Connector endpoint "${key}" portT requires the port on a block ref (the edge anchor's position along the side).`,
          });
        } else if (typeof ref.portT !== "number" || !Number.isFinite(ref.portT) || ref.portT < 0 || ref.portT > 1) {
          errors.push({
            path: `${path}.attrs.${key}.portT`,
            message: `The connector endpoint's portT must stand within the side's 0–1 (got ${show(ref.portT)}).`,
          });
        }
      }
    }
  }
}

export { validateCanvasBlock, validateGeometry };
export { validateDatabaseBlock } from "./database-block";
export { checkDatabaseCellValue, checkDatabaseFilter } from "./database-contract";
