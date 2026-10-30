/**
 * The document-level validation: the meta fields, the whole-doc pass
 * (validateDoc: blocks, children, reachability, the flat page sequences,
 * the table row/column invariants), and the per-block / per-mark entry
 * points over the registry specs.
 */
import type { BlockType } from "../../block-union";
import { isReservedId } from "../../id-safety";
import { BLOCK_REGISTRY } from "../../registry";
import { indentOf } from "../../utils";
import { CANVAS_ZORDER_TYPES } from "../../z-order";
import { DOC_FIELDS, KNOWN_DOC_FIELDS } from "../constants";
import type { ValidationError } from "../models";
import { checkDatabaseFilter, validateCanvasBlock, validateDatabaseBlock, validateGeometry } from "./blocks";
import { isIso8601, isPlainObject, show } from "./common";
import { validateAttrs, validateContent, validateMarks } from "./content";

function validateMeta(doc: Record<string, unknown>, errors: ValidationError[]): void {
  for (const field of DOC_FIELDS) {
    if (!(field in doc)) errors.push({ path: field, message: `Missing required field "${field}".` });
  }
  for (const field of Object.keys(doc)) {
    if (!KNOWN_DOC_FIELDS.includes(field)) {
      errors.push({ path: field, message: `Unknown field "${field}".` });
    }
  }

  if ("v" in doc && doc.v !== 1) {
    errors.push({ path: "v", message: `Unsupported schema version ${show(doc.v)} (expected 1).` });
  }
  if ("id" in doc && (typeof doc.id !== "string" || doc.id.length === 0)) {
    errors.push({ path: "id", message: `id must be a non-empty string (got ${show(doc.id)}).` });
  }
  if ("title" in doc && typeof doc.title !== "string") {
    errors.push({ path: "title", message: `title must be a string (got ${show(doc.title)}).` });
  }
  if ("avatar" in doc && typeof doc.avatar !== "string") {
    errors.push({ path: "avatar", message: `avatar must be a string (got ${show(doc.avatar)}).` });
  }
  if ("createdAt" in doc && !isIso8601(doc.createdAt)) {
    errors.push({
      path: "createdAt",
      message: `createdAt must be an ISO 8601 date-time (got ${show(doc.createdAt)}).`,
    });
  }
}

/**

 * (shape / connector / canvas-text / group) carry a `zIndex` attr that is the
 * element's position among the surface's canvas elements (dense 1..N, the
 * children order's mirror — 1 = bottom). The invariant is all-or-nothing per
 * surface: if any canvas element carries a `zIndex`, all of them must, and the
 * set must be the dense 1..N sequence. A surface with no `zIndex` at all is
 * the legacy form (the lenient reader derives it from the children position).
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
 * (registry `sequence` flag: root, table-cell, frame); structural order
 * (table-row grid, surface z-order) ignores indent.
 */
function validateSequences(blocks: Record<string, unknown>, errors: ValidationError[]): void {
  for (const block of Object.values(blocks)) {
    if (!isPlainObject(block)) continue;
    const type = block.type;
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY) || !BLOCK_REGISTRY[type as BlockType].sequence) continue;
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
  if ("geometry" in block) validateGeometry(block.geometry, `blocks.${id}.geometry`, errors);
}

/**
 * Validates a plain JSON document against schema v1.
 *
 * Strict posture (the default): unknown block types, marks, attributes, and
 * fields are rejected — the validator protects data written by this engine.
 * Lenient posture (`lenient: true`, the cross-minor load): a reader of
 * major 1 opening a newer minor's v1 data tolerates the additive unknowns —
 * an unknown block type stands as opaque data (the structural invariants
 * only), an unknown attribute and an unknown mark are preserved as-is (the
 * known attrs/marks keep their value checks). The lenient fallback rendering
 * (the placeholder for the unknown type, the text without the unknown mark)
 * is a reader/renderer concern.
 *
 * Collects all violations (does not stop at the first) and reports them in
 * document order. An empty result means the document is valid.
 */
function validateDoc(json: unknown, lenient = false): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!isPlainObject(json)) {
    return [{ path: "", message: `The document must be a plain object (got ${show(json)}).` }];
  }

  validateMeta(json, errors);
  if (!isPlainObject(json.blocks)) {
    if ("blocks" in json)
      errors.push({ path: "blocks", message: `blocks must be a plain object (got ${show(json.blocks)}).` });
    return errors;
  }
  const blocks = json.blocks;

  let rootId: string | undefined;
  const firstParent = new Map<string, { parentId: string; path: string }>();
  const referenceCount = new Map<string, number>();

  for (const [id, block] of Object.entries(blocks)) {
    // A reserved id (an Object.prototype key) cannot be a key of the plain
    // blocks map (it would be lost on the JSON round trip): reject it.
    if (isReservedId(id)) {
      errors.push({
        path: `blocks.${id}`,
        message: `The block id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`,
      });
      continue;
    }
    if (!isPlainObject(block)) {
      errors.push({ path: `blocks.${id}`, message: `A block must be a plain object (got ${show(block)}).` });
      continue;
    }

    const type = block.type;
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY)) {
      if (!lenient) {
        errors.push({ path: `blocks.${id}`, message: `Unknown block type ${show(type)}.` });
        continue;
      }
      // Lenient (cross-minor load): the unknown type stands as opaque data —
      // the structural invariants only (the children id array, the
      // geometry); the per-type rules are skipped (the engine does not know
      // the type's contract).
      validateOpaqueStructure(id, block, blocks, firstParent, referenceCount, errors);
      continue;
    }
    const blockType = type as BlockType;
    const spec = BLOCK_REGISTRY[blockType];

    if (blockType === "root") {
      // An invalid or missing id is reported on the meta field already.
      if (typeof json.id === "string" && id !== json.id) {
        errors.push({
          path: `blocks.${id}`,
          message: `The root block must be keyed by the document id "${json.id}" (got "${id}").`,
        });
      }
      if (rootId !== undefined) {
        errors.push({
          path: `blocks.${id}`,
          message: `The document must contain exactly one root block (first is "${rootId}").`,
        });
      } else {
        rootId = id;
      }
      if (!Array.isArray(block.children)) {
        errors.push({ path: `blocks.${id}.children`, message: "The root block must have a children array." });
      }
    }

    if (!spec.content && "content" in block) {
      errors.push({ path: `blocks.${id}.content`, message: `Block type "${blockType}" has no content.` });
    } else if ("content" in block && spec.content) {
      validateContent(blockType, block.content, `blocks.${id}.content`, errors, lenient);
    }

    // Writer contract vs legacy form: structural containers keep `children`
    // (their order); the remodeled page types carry it only in the legacy
    // nesting form (still valid v1, the same child-type rules apply). Both
    // shapes are accepted; the strictness is about the rules, not the shape.
    const allowedChildTypes = spec.childrenTypes ?? spec.legacyChildrenTypes;
    if ("children" in block && allowedChildTypes === undefined) {
      errors.push({ path: `blocks.${id}.children`, message: `Block type "${blockType}" has no children.` });
    } else if ("children" in block && allowedChildTypes !== undefined) {
      if (!Array.isArray(block.children)) {
        errors.push({
          path: `blocks.${id}.children`,
          message: `children must be an array of block ids (got ${show(block.children)}).`,
        });
      } else {
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
          const childBlock = blocks[childId];
          if (isPlainObject(childBlock) && typeof childBlock.type === "string" && childBlock.type in BLOCK_REGISTRY) {
            if (!allowedChildTypes.includes(childBlock.type as BlockType)) {
              errors.push({
                path: childPath,
                message: `Block type "${childBlock.type}" is not allowed as a child of "${blockType}".`,
              });
            }
          }
        });
      }
    }

    if (!spec.rows && "rows" in block) {
      errors.push({ path: `blocks.${id}.rows`, message: `Block type "${blockType}" has no rows.` });
    }
    if (!spec.rows && "rowOrder" in block) {
      errors.push({ path: `blocks.${id}.rowOrder`, message: `Block type "${blockType}" has no rowOrder.` });
    }
    if (spec.rows) validateDatabaseBlock(block, `blocks.${id}`, errors);

    if ("geometry" in block) validateGeometry(block.geometry, `blocks.${id}.geometry`, errors);
    if (blockType === "shape" || blockType === "connector" || blockType === "group") {
      validateCanvasBlock(blockType, block, `blocks.${id}`, errors);
    }

    validateAttrs(blockType, spec, block.attrs, `blocks.${id}.attrs`, errors, lenient);
  }

  if (rootId === undefined) {
    errors.push({ path: "blocks", message: "The document must contain a root block." });
    return errors;
  }

  // Every block except the root must be reachable from the root.
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
    if (id !== rootId && !visited.has(id)) {
      errors.push({ path: `blocks.${id}`, message: `Orphan block "${id}" (unreachable from root).` });
    }
  }

  // The flat page sequences: the indent-jump rule per sequence container.
  validateSequences(blocks, errors);

  // The surface's explicit z-order (the canvas elements' dense zIndex).
  validateSurfaceZOrder(blocks, errors);

  // The table's columnOrder invariants (once each): the column set (unique
  // non-empty ids), and the columnWidths mirror the set (one width per column).
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const columnOrder = (block as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) {
      errors.push({
        path: `blocks.${id}.columnOrder`,
        message: "A table must carry a columnOrder array of column ids.",
      });
      continue;
    }
    const columnIds = columnOrder as unknown[];
    // The column set is unique (no duplicate column ids).
    const seen = new Set<string>();
    let setValid = true;
    for (const columnId of columnIds) {
      if (typeof columnId !== "string" || columnId === "" || seen.has(columnId)) {
        errors.push({
          path: `blocks.${id}.columnOrder`,
          message: "The table's columnOrder must be an array of unique non-empty column ids.",
        });
        setValid = false;
        break;
      }
      // A reserved column id (an Object.prototype key) would be lost on the
      // JSON export (the id-keyed-map trap): reject it.
      if (isReservedId(columnId)) {
        errors.push({
          path: `blocks.${id}.columnOrder`,
          message: `The column id "${columnId}" is reserved (it collides with Object.prototype) and cannot be used.`,
        });
        setValid = false;
        break;
      }
      seen.add(columnId);
    }
    const cols = columnIds.length;
    const widths = (block as { attrs?: { columnWidths?: unknown } }).attrs?.columnWidths;
    if (setValid && Array.isArray(widths) && widths.length !== cols) {
      errors.push({
        path: `blocks.${id}.attrs.columnWidths`,
        message: `The table's columnWidths must hold exactly ${cols} width(s); found ${widths.length}.`,
      });
    }
  }

  // Every table row holds AT MOST the parent table's columnOrder cells,
  // each bound to its column by `columnId`. A short row (fewer cells than
  // columns) is a valid CRDT race residue: a row created before a
  // concurrent column insert keeps its cell set, and the read/UI stands the
  // missing cells as placeholders (the cells stand by id, not position). An
  // overfull row is corrupt (a cell can exist only for a column that was in
  // the columnOrder when it was written). On a full row, each cell's
  // columnId must match its position in the columnOrder (the cells stand in
  // columnOrder order).
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table-row") continue;
    if (referenceCount.get(id) !== 1) continue; // missing/multiple parents are reported above
    const reference = firstParent.get(id);
    if (!reference) continue;
    const parent = blocks[reference.parentId];
    if (!isPlainObject(parent) || parent.type !== "table") continue;
    const columnOrder = (parent as { columnOrder?: unknown }).columnOrder;
    if (!Array.isArray(columnOrder)) continue; // invalid columnOrder is reported on the table
    const columnIds = columnOrder as unknown[];
    const children = block.children;
    if (!Array.isArray(children)) {
      errors.push({
        path: `blocks.${id}.children`,
        message: "A table row must carry a children array of cell ids.",
      });
      continue;
    }
    if (children.length > columnIds.length) {
      errors.push({
        path: `blocks.${id}.children`,
        message: `A table row must not hold more than ${columnIds.length} cell(s); found ${children.length}.`,
      });
      continue;
    }
    if (children.length < columnIds.length) continue; // race residue: the read stands the missing cells as placeholders
    // Full row: each cell's columnId matches its position in the columnOrder.
    children.forEach((cellId, position) => {
      const cell = blocks[cellId as string];
      if (!isPlainObject(cell) || cell.type !== "table-cell") return; // missing/mis-typed cells are reported above
      const columnId = (cell as { attrs?: { columnId?: unknown } }).attrs?.columnId;
      const expected = columnIds[position];
      if (columnId !== expected) {
        errors.push({
          path: `blocks.${cellId as string}.attrs.columnId`,
          message: `The cell's columnId must stand ${JSON.stringify(expected)} (its position in the table's columnOrder); found ${JSON.stringify(columnId)}.`,
        });
      }
    });
  }

  return errors;
}

/**
 * Validates block attrs against the registry rules of the type: unknown
 * keys, missing required attrs, and value rules. `undefined` is valid only
 * for types without attrs. An empty result means the attrs are valid.
 */
function validateBlockAttrs(type: BlockType, attrs: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateAttrs(type, BLOCK_REGISTRY[type], attrs, "attrs", errors);
  // The database's recursive filter payload is not expressible in the flat
  // AttrSpec (the registry keeps `filter` a plain `object`): the command
  // paths (insertBlock / updateBlock) reject an invalid payload here, like
  // the doc-level validator does.
  if (type === "database" && isPlainObject(attrs) && attrs.filter !== undefined) {
    checkDatabaseFilter(attrs.filter, "attrs.filter", errors);
  }
  return errors;
}

/**
 * Validates a mark set for a run of the given block type: known marks with
 * well-formed values, no marks in a code block, no coexistence with an
 * exclusive mark. An empty result means the marks are valid.
 */
function validateMarkSet(blockType: BlockType, marks: unknown): ValidationError[] {
  const errors: ValidationError[] = [];
  validateMarks(blockType, marks, "marks", errors);
  return errors;
}

export { validateBlockAttrs, validateDoc, validateMarkSet };
