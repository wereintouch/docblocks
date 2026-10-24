/**
 * The document-level validation: the meta fields, the whole-doc pass
 * (validateDoc: blocks, children, reachability, the flat page sequences,
 * the table row/column invariants), and the per-block / per-mark entry
 * points over the registry specs.
 */
import type { BlockType } from "../../block-union";
import { BLOCK_REGISTRY } from "../../registry";
import { DOC_FIELDS, KNOWN_DOC_FIELDS } from "../models";
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

/** The block's effective indent; absent (or a non-integer, reported by the attrs spec) is 0. */
function indentOf(block: Record<string, unknown>): number {
  const attrs = isPlainObject(block.attrs) ? block.attrs : undefined;
  const indent = attrs?.indent;
  return typeof indent === "number" && Number.isInteger(indent) ? indent : 0;
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
 * Validates a plain JSON document against schema v1.
 *
 * Strict posture: unknown block types, marks, attributes, and fields are
 * rejected — the validator protects data written by this engine. Lenient
 * fallback behavior is a reader/renderer concern.
 *
 * Collects all violations (does not stop at the first) and reports them in
 * document order. An empty result means the document is valid.
 */
function validateDoc(json: unknown): ValidationError[] {
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
    if (!isPlainObject(block)) {
      errors.push({ path: `blocks.${id}`, message: `A block must be a plain object (got ${show(block)}).` });
      continue;
    }

    const type = block.type;
    if (typeof type !== "string" || !(type in BLOCK_REGISTRY)) {
      errors.push({ path: `blocks.${id}`, message: `Unknown block type ${show(type)}.` });
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
      validateContent(blockType, block.content, `blocks.${id}.content`, errors);
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

    validateAttrs(blockType, spec, block.attrs, `blocks.${id}.attrs`, errors);
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

  // Every table row holds exactly the parent table's `cols` cells.
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table-row") continue;
    if (referenceCount.get(id) !== 1) continue; // missing/multiple parents are reported above
    const reference = firstParent.get(id);
    if (!reference) continue;
    const parent = blocks[reference.parentId];
    if (!isPlainObject(parent) || parent.type !== "table") continue;
    const cols = (parent as { attrs?: { cols?: unknown } }).attrs?.cols;
    if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 1) continue; // invalid cols is reported on the table
    const children = block.children;
    if (!Array.isArray(children) || children.length !== cols) {
      errors.push({
        path: `blocks.${id}.children`,
        message: `A table row must have exactly ${cols} cell(s); found ${Array.isArray(children) ? children.length : 0}.`,
      });
    }
  }

  // The tables' columnWidths invariants (one entry per column), once each.
  for (const [id, block] of Object.entries(blocks)) {
    if (!isPlainObject(block) || block.type !== "table") continue;
    const cols = (block as { attrs?: { cols?: unknown } }).attrs?.cols;
    if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 1) continue; // invalid cols is reported on the table
    const widths = (block as { attrs?: { columnWidths?: unknown } }).attrs?.columnWidths;
    if (Array.isArray(widths) && widths.length !== cols) {
      errors.push({
        path: `blocks.${id}.attrs.columnWidths`,
        message: `The table's columnWidths must hold exactly ${cols} width(s); found ${widths.length}.`,
      });
    }
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
