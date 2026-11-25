/**
 * The block structure insert command: insertBlock. A command validates
 * first (typed errors, no silent no-ops) and then mutates in one
 * transaction with the local origin.
 */
import * as Y from "yjs";

import {
  BLOCK_REGISTRY,
  isRegisteredBlockType,
  isReservedId,
  isSafeEmbedSrc,
  validateBlockAttrs,
  validateCanvasBlock,
} from "@docblocks-core/schema";
import type { BlockId, BlockType, ValidationError } from "@docblocks-core/schema";

import {
  DetachedBlockError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  UnknownBlockError,
  UnknownBlockTypeError,
  formatValidationErrors,
} from "../errors";
import { localTransact } from "../layout";
import { readMeta } from "../read";
import { isPlainObject, writeNewBlock } from "./block-write";
import type { InsertBlockPosition } from "./block-write";
import { assertValidDatabaseInsert } from "./database";
import {
  blockTypeOf,
  childrenOf,
  findParent,
  getBlockMap,
  getBlocks,
  indentJumpViolation,
  indentOfBlock,
  readCols,
} from "./structure";
import { standsInMergedRegion } from "./table/merges";
import { CANVAS_ZORDER_TYPES, refreshSurfaceZIndex } from "./z-order";

/** Inserts a new block under `at.parent` (default: root) after `at.after` (default: appended). */
function insertBlock(
  ydoc: Y.Doc,
  generateId: () => string,
  type: BlockType,
  attrs: unknown,
  at?: InsertBlockPosition
): BlockId {
  if (!isRegisteredBlockType(type)) throw new UnknownBlockTypeError(`Unknown block type "${String(type)}".`);
  if (type === "root") throw new InvalidOperationError("The root block already exists and cannot be inserted.");

  // An explicit id must be fresh (a deterministic concurrent insert — the
  // tail paragraph — is idempotent at the write, not a re-insert).
  const explicitId = at?.id;
  if (explicitId !== undefined) {
    if (explicitId === "") throw new InvalidOperationError("An explicit block id must be a non-empty string.");
    if (getBlocks(ydoc).has(explicitId)) {
      throw new InvalidOperationError(`A block with id "${explicitId}" already exists.`);
    }
  }

  // The table's initial column count (a creation hint, not an attr): the
  // columnOrder is seeded with the given number of column ids (default 1). The
  // hint is extracted before the attrs validation (it is not a stored attr).
  let tableAttrs = attrs;
  let initialCols = 1;
  if (type === "table" && isPlainObject(attrs) && typeof attrs.cols === "number") {
    initialCols = attrs.cols;
    if (!Number.isInteger(initialCols) || initialCols < 1) {
      throw new InvalidAttrsError(
        `Invalid attrs for block type "table": the initial column count must be an integer >= 1 (got ${initialCols}).`
      );
    }
    const rest: Record<string, unknown> = { ...attrs };
    delete rest.cols;
    tableAttrs = rest;
  }

  const attrErrors = validateBlockAttrs(type, tableAttrs);
  if (attrErrors.length > 0) {
    throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${formatValidationErrors(attrErrors)}`);
  }

  // The canvas's block-level attrs invariants (the points tuples, the
  // connector refs) are checked on the post-insert attrs (the registry
  // attrs spec expresses only the per-attr rules).
  if (type === "shape" || type === "connector") {
    const canvasErrors: ValidationError[] = [];
    validateCanvasBlock(type, { type, attrs }, "blocks.new", canvasErrors);
    if (canvasErrors.length > 0) {
      throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${formatValidationErrors(canvasErrors)}`);
    }
  }

  // The embed's kind x src cross-field rule (the unsafe scheme stands the
  // XSS over the consumer's sandbox grant / the phishing surface).
  if (type === "embed" && isPlainObject(tableAttrs) && typeof tableAttrs.src === "string") {
    const kind = typeof tableAttrs.kind === "string" ? tableAttrs.kind : "iframe";
    if (!isSafeEmbedSrc(kind, tableAttrs.src)) {
      throw new InvalidAttrsError(
        `Invalid attrs for block type "embed": the src is not a safe URL for kind "${kind}" (absolute http/https only; the html kind stands the data:text/html snippet additionally).`
      );
    }
  }

  const parentId = at?.parent ?? readMeta(ydoc).id;
  const parentType = blockTypeOf(ydoc, parentId);
  if (parentType === null) throw new UnknownBlockError(`Unknown block "${parentId}".`);
  const parentSpec = BLOCK_REGISTRY[parentType];
  if (!parentSpec.children) {
    // The remodeled page types used to carry children (the legacy form) — a
    // typed rejection: the nesting is the flat sequence's indent attr.
    if (parentSpec.legacyChildrenTypes !== undefined) {
      throw new InvalidOperationError(
        `Block "${parentId}" (type "${parentType}") no longer carries children: page content is a flat sequence — insert after it in the page sequence (the nesting is the indent attr).`
      );
    }
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (!parentSpec.childrenTypes?.includes(type)) {
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }

  const children = childrenOf(ydoc, parentId);
  if (children === null) {
    throw new InvalidOperationError(`Block "${parentId}" (type "${parentType}") has no children.`);
  }
  const childIds = children.toArray();
  let index = childIds.length;
  if (at?.after !== undefined) {
    const afterIndex = childIds.indexOf(at.after);
    if (afterIndex === -1) throw new DetachedBlockError(`Block "${at.after}" is not a child of "${parentId}".`);
    index = afterIndex + 1;
  }

  // The flat page model: the new block's indent must keep the
  // sequence's jump rule at its landing position.
  if (parentSpec.sequence) {
    const newIndent =
      tableAttrs !== undefined && isPlainObject(tableAttrs) && typeof tableAttrs.indent === "number"
        ? tableAttrs.indent
        : 0;
    const violation = indentJumpViolation(ydoc, childIds, index, newIndent);
    if (violation !== null) {
      throw new InvalidAttrsError(`Invalid attrs for block type "${type}": ${violation}.`);
    }
    // The displaced block (the one standing at the index before the
    // insert) gets the new block as its new predecessor: a new block with
    // a shallower indent would dangle the displaced deeper block (the TO
    // side of the jump rule) — rejected the same way.
    const displaced = childIds[index];
    if (displaced !== undefined) {
      const displacedIndent = indentOfBlock(ydoc, displaced);
      if (displacedIndent > newIndent + 1) {
        throw new InvalidAttrsError(
          `The block of type "${type}" cannot be inserted here: the displaced block's indent (${displacedIndent}) must not exceed the new block's indent (${newIndent}) by more than 1.`
        );
      }
    }
  }

  // A row stays full: a new cell is allowed only while the row holds fewer
  // cells than the table's `cols` (completing a row under construction).
  if (type === "table-cell") {
    const cellCount = childIds.length;
    const tableId = findParent(ydoc, parentId);
    const cols = tableId !== null ? readCols(ydoc, tableId) : null;
    if (cols === null) {
      throw new InvalidOperationError(`Row "${parentId}" is not a child of a table with a valid "cols" attribute.`);
    }
    if (cellCount >= cols) {
      throw new InvalidOperationError(`Row "${parentId}" already has ${cellCount} of ${cols} cells; the row is full.`);
    }
    // A merged region owns its rows' cells: the positional binding would
    // land the new cell on a covered column (the region's cells come from
    // splitTableCells, not the generic insert).
    if (tableId !== null && standsInMergedRegion(ydoc, tableId, parentId)) {
      throw new InvalidOperationError(
        `Row "${parentId}" stands in a merged region; split the region before inserting a cell.`
      );
    }
  }

  // The database's type-dependent column rules (the options presence, the
  // duplicate ids) are block-level invariants, not per-attribute rules: they
  // run on the post-insert block (an empty rows / rowOrder).
  if (type === "database") {
    assertValidDatabaseInsert(attrs);
  }

  const id = explicitId ?? generateId();
  // A reserved id (an Object.prototype key) would be lost on the JSON export
  // (the id-keyed-map trap): reject it at the boundary.
  if (isReservedId(id)) {
    throw new InvalidOperationError(
      `The block id "${id}" is reserved (it collides with Object.prototype) and cannot be used.`
    );
  }
  localTransact(ydoc, () => {
    // The explicit id is idempotent: a peer's concurrent insert of the
    // same id (the deterministic tail paragraph) wins — the entry and the
    // order slot are written only when absent, so the race converges to
    // one block and one slot.
    const blocks = getBlocks(ydoc);
    if (!(blocks.get(id) instanceof Y.Map)) writeNewBlock(blocks, id, type, tableAttrs);
    if (!children.toArray().includes(id)) children.insert(index, [id]);
    // The owner parent (the single CRDT-resolved ownership stand): set on
    // the entry so a concurrent move/insert of the same id resolves to one
    // owner, not a duplicate reference.
    const blockMap = blocks.get(id);
    if (blockMap instanceof Y.Map) blockMap.set("parent", parentId);
    // The table's initial column set (the columnOrder): a fresh table starts
    // with one column (the column commands add/remove the rest). Idempotent
    // over the explicit-id race (only a fresh empty order is seeded).
    if (type === "table" && blockMap instanceof Y.Map) {
      const columnOrder = blockMap.get("columnOrder");
      if (columnOrder instanceof Y.Array && columnOrder.length === 0) {
        for (let i = 0; i < initialCols; i += 1) {
          const columnId = generateId();
          // A reserved column id (a custom generateId) would be lost on the
          // JSON export: reject it at the boundary.
          if (isReservedId(columnId)) {
            throw new InvalidOperationError(
              `The column id "${columnId}" is reserved (it collides with Object.prototype) and cannot be used.`
            );
          }
          columnOrder.push([columnId]);
        }
      }
      // The caller's initial columnWidths (positional) stand identity-keyed
      // (columnId → width): an explicit entry only for the given values —
      // an absent key stands the default width at read time. Idempotent
      // over the explicit-id race, like the columnOrder seed above.
      const callerWidths = isPlainObject(attrs) ? (attrs as Record<string, unknown>).columnWidths : undefined;
      if (Array.isArray(callerWidths)) {
        const order = blockMap.get("columnOrder");
        if (order instanceof Y.Array) {
          let blockAttrs = blockMap.get("attrs");
          if (!(blockAttrs instanceof Y.Map)) {
            blockAttrs = new Y.Map<unknown>();
            blockMap.set("attrs", blockAttrs);
          }
          let widths = blockAttrs.get("columnWidths");
          if (!(widths instanceof Y.Map)) {
            widths = new Y.Map<unknown>();
            blockAttrs.set("columnWidths", widths);
          }
          order.toArray().forEach((columnId, i) => {
            const value = callerWidths[i];
            if (typeof value === "number" && Number.isFinite(value)) widths.set(columnId, value);
          });
        }
      }
    }
    // The table cell's column binding: the cell's columnId stands the column
    // at its position in the row (the table's columnOrder entry). Set
    // automatically (the caller doesn't know the column context).
    if (type === "table-cell" && blockMap instanceof Y.Map) {
      const tableId = findParent(ydoc, parentId);
      const tableMap = tableId !== null ? getBlockMap(ydoc, tableId) : null;
      const columnOrder = tableMap !== null ? tableMap.get("columnOrder") : null;
      if (columnOrder instanceof Y.Array) {
        const columnId = columnOrder.toArray()[index];
        if (typeof columnId === "string") {
          let attrs = blockMap.get("attrs");
          if (!(attrs instanceof Y.Map)) {
            attrs = new Y.Map<unknown>();
            blockMap.set("attrs", attrs);
          }
          attrs.set("columnId", columnId);
        }
      }
    }
    // The canvas element's explicit z-order index (dense 1..N, the order's
    // mirror): a new surface canvas element takes its position among the
    // canvas elements (the default insert at the end is max + 1, on top).
    if (parentType === "surface" && CANVAS_ZORDER_TYPES.has(type)) refreshSurfaceZIndex(ydoc, parentId);
  });
  return id;
}

export { insertBlock };
