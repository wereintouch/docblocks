/**
 * Block structure commands: insertBlock, moveBlock, removeBlock.
 * A command validates first (typed errors, no silent no-ops) and then
 * mutates in one transaction with the local origin.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, isReservedId, validateBlockAttrs, validateCanvasBlock } from "@docblocks-core/schema";
import type { AttrsFor, BlockId, BlockType, ValidationError } from "@docblocks-core/schema";

import {
  DetachedBlockError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  UnknownBlockTypeError,
  formatValidationErrors,
} from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readMeta } from "../read";
import { assertValidDatabaseInsert } from "./database";
import {
  blockTypeOf,
  childrenOf,
  findParent,
  getBlockMap,
  getBlocks,
  indentJumpViolation,
  indentOfBlock,
  isDescendant,
  isPageSequence,
  readCols,
} from "./structure";
import { CANVAS_ZORDER_TYPES, refreshSurfaceZIndex } from "./z-order";

/** Where to insert a new block: under `parent`, after the sibling `after`. */
interface InsertBlockPosition {
  /** Parent block id; defaults to the root block (id === doc id). */
  parent?: BlockId;
  /** Existing child of `parent`; the new block lands right after it. */
  after?: BlockId;
  /** Explicit block id (additive). The id stands in the blocks map and
   *  the parent's order; a collision with an existing block is rejected.
   *  The write is idempotent: a concurrent peer insert of the same id
   *  (the deterministic tail paragraph) converges to one block and one
   *  order slot. */
  id?: BlockId;
}

/**
 * Argument tuple of `insertBlock`: attrs are required exactly when the type
 * has attrs (see AttrsFor); `at` is optional. The table's `cols` is a
 * creation hint (the initial column count that seeds the columnOrder), not a
 * stored attr — it is accepted in the insert attrs only. The table check is
 * non-distributive (`[T] extends ["table"]`): a distributive form would
 * collapse a union type argument (e.g. "paragraph" | "list-item") into
 * per-member tuples and reject the call.
 */
type InsertBlockArgs<T extends BlockType> = [T] extends ["table"]
  ? [type: T, attrs?: AttrsFor<T> & { cols?: number }, at?: InsertBlockPosition]
  : undefined extends AttrsFor<T>
    ? [type: T, attrs?: AttrsFor<T>, at?: InsertBlockPosition]
    : [type: T, attrs: AttrsFor<T>, at?: InsertBlockPosition];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Writes a fresh block, creating only the fields its type has per the registry. */
function writeNewBlock(blocks: Y.Map<unknown>, id: string, type: BlockType, attrs: unknown): void {
  const spec = BLOCK_REGISTRY[type];
  const yblock = new Y.Map<unknown>();
  yblock.set("type", type);

  // The attrs map is kept by reference: an unattached Y.Map cannot be read
  // back through yblock.get (the read lands before the attach), so the
  // type-specific branches below extend the local map instead.
  let attrsMap: Y.Map<unknown> | undefined;
  if (spec.attrs !== undefined && isPlainObject(attrs)) {
    // The table's columnWidths are stored identity-keyed (columnId → width,
    // seeded from the caller's positional array by the insert transaction,
    // which knows the generated column ids) — skipped here.
    const attrEntries = Object.entries(attrs).filter(
      ([key, value]) => value !== undefined && !(type === "table" && key === "columnWidths")
    );
    if (attrEntries.length > 0) {
      attrsMap = new Y.Map<unknown>();
      for (const [key, value] of attrEntries) writeAttrValue(attrsMap, key, value);
      yblock.set("attrs", attrsMap);
    }
  }

  if (spec.content) yblock.set("content", new Y.Text());
  if (spec.children) yblock.set("children", new Y.Array<string>());
  if (spec.rows) {
    yblock.set("rows", new Y.Map<unknown>());
    yblock.set("rowOrder", new Y.Array<string>());
  }
  if (spec.columnOrder) {
    // The fresh table holds no width entries yet (an absent entry stands
    // the default width at read time); the insert transaction seeds the
    // caller's widths identity-keyed, keyed by the generated column ids.
    yblock.set("columnOrder", new Y.Array<string>());
  }
  blocks.set(id, yblock);
}

/** Inserts a new block under `at.parent` (default: root) after `at.after` (default: appended). */
function insertBlock(
  ydoc: Y.Doc,
  generateId: () => string,
  type: BlockType,
  attrs: unknown,
  at?: InsertBlockPosition
): BlockId {
  if (!(type in BLOCK_REGISTRY)) throw new UnknownBlockTypeError(`Unknown block type "${String(type)}".`);
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

/**
 * Moves a block to `toIndex` under `toParent` (pre-move index semantics).
 * The root cannot be moved; moving into itself or a descendant is rejected.
 */
function moveBlock(ydoc: Y.Doc, id: string, toParent: string, toIndex: number): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (type === "root") throw new InvalidOperationError("The root block cannot be moved.");

  const parentType = blockTypeOf(ydoc, toParent);
  if (parentType === null) throw new UnknownBlockError(`Unknown block "${toParent}".`);
  const parentSpec = BLOCK_REGISTRY[parentType];
  if (!parentSpec.children) {
    // The remodeled page types used to carry children (the legacy form) — a
    // typed rejection: the nesting is the flat sequence's indent attr.
    if (parentSpec.legacyChildrenTypes !== undefined) {
      throw new InvalidOperationError(
        `Block "${toParent}" (type "${parentType}") no longer carries children: page content is a flat sequence — move within the page sequence (the nesting is the indent attr).`
      );
    }
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (!parentSpec.childrenTypes?.includes(type)) {
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType}".`);
  }
  if (id === toParent || isDescendant(ydoc, id, toParent)) {
    throw new InvalidOperationError(`Block "${id}" cannot be moved into itself or its descendant "${toParent}".`);
  }

  const fromParent = findParent(ydoc, id);
  if (fromParent === null) throw new InvalidOperationError(`Block "${id}" has no parent.`);
  const fromChildren = childrenOf(ydoc, fromParent);
  const toChildren = childrenOf(ydoc, toParent);
  if (fromChildren === null || toChildren === null) {
    throw new InvalidOperationError(`Blocks "${fromParent}" and "${toParent}" must have children.`);
  }

  const fromIndex = fromChildren.toArray().indexOf(id);
  const toLength = toChildren.toArray().length;
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex > toLength) {
    throw new InvalidRangeError(`toIndex must be an integer in [0, ${toLength}] (got ${toIndex}).`);
  }

  // Same-parent move: pre-move indices, so removal shifts the target left.
  const insertAt = fromChildren === toChildren && fromIndex < toIndex ? toIndex - 1 : toIndex;

  // The flat page model: the landed position must keep the
  // sequence's jump rule (the block's indent does not change on a move).
  // (The open-transaction marker is the Yjs `_transaction` slot: set while
  // any transaction on the doc is in flight, null otherwise.)
  const inBatch = (ydoc as unknown as { _transaction?: unknown })._transaction !== null;
  if (parentSpec.sequence) {
    const post = toChildren.toArray().filter((child) => child !== id);
    post.splice(insertAt, 0, id);
    const violation = indentJumpViolation(ydoc, post, insertAt, indentOfBlock(ydoc, id));
    if (violation !== null) {
      throw new InvalidOperationError(`Block "${id}" cannot move to position ${insertAt}: ${violation}.`);
    }
    // The displaced block (the one standing at the landing before the
    // insert) gets the moved block as its new predecessor: its pair must
    // keep the rule too — a shallower block landing mid-segment would
    // otherwise dangle the displaced deeper block (the TO side of the
    // jump rule; the stranding guard is the FROM-side complement). The
    // check stands only for a command that commits its own transaction —
    // a batched composition (the UI's seam drag) moves the block at its
    // old indent and updates the indent in the same atomic transact, so
    // the mid-transact pair is a transient the composition resolves
    // (the seam rule owns the final state); the same posture as the
    // stranding guard below.
    if (!inBatch) {
      const displaced = post[insertAt + 1];
      if (displaced !== undefined) {
        const displacedViolation = indentJumpViolation(ydoc, post, insertAt + 1, indentOfBlock(ydoc, displaced));
        if (displacedViolation !== null) {
          throw new InvalidOperationError(
            `Block "${id}" cannot move to position ${insertAt}: block "${displaced}" would be displaced (${displacedViolation}).`
          );
        }
      }
    }
  }

  // The flat page model: the move carries the block ALONE — its derived
  // segment (the deeper followers) stays at the head's old slot, where
  // the new predecessor (the head's old predecessor, or the sequence's
  // start) can break the jump rule. The command moves one block (the UI
  // composes whole-segment moves), so a stranding is rejected instead of
  // cascaded. The rejection stands only for a command that commits its
  // own transaction: inside the caller's open batch (a `doc.transact`
  // composition — the UI's segment move) the stranding is a mid-batch
  // transient the composition's later steps resolve, and the Yjs
  // transaction's atomicity keeps it off the wire and off every listener.
  // The check runs over the post-move from-sequence at the first
  // follower's landing.
  if (!inBatch && isPageSequence(ydoc, fromParent)) {
    const fromIds = fromChildren.toArray();
    const ownIndent = indentOfBlock(ydoc, id);
    let segmentEnd = fromIndex + 1;
    for (let i = fromIndex + 1; i < fromIds.length; i += 1) {
      const next = fromIds[i];
      if (next === undefined || indentOfBlock(ydoc, next) <= ownIndent) break;
      segmentEnd = i + 1;
    }
    if (segmentEnd > fromIndex + 1) {
      // The post-move from-sequence: the head removed, and re-inserted at
      // its landing when the move is within the sequence. The first
      // follower's post-move index is the head's old slot (the removal
      // shifts it left), shifted right by a same-sequence landing at or
      // before the slot — at the slot itself the head stands right before
      // the follower, its old position (the in-place no-op).
      const postFrom = fromIds.filter((child) => child !== id);
      if (fromChildren === toChildren) postFrom.splice(insertAt, 0, id);
      const followerIndex = fromChildren === toChildren && insertAt <= fromIndex ? fromIndex + 1 : fromIndex;
      const follower = postFrom[followerIndex];
      if (follower !== undefined) {
        const violation = indentJumpViolation(ydoc, postFrom, followerIndex, indentOfBlock(ydoc, follower));
        if (violation !== null) {
          throw new InvalidOperationError(
            `Block "${id}" cannot move without its derived segment: block "${follower}" would be stranded (${violation}). The segment must be moved with the block — moveBlock moves one block.`
          );
        }
      }
    }
  }

  // Table invariants: a cell is bound to its column (its position in the
  // row ↔ the table's columnOrder), so a cell cannot move at all — not
  // between rows and not within its row (the column order is managed by
  // moveTableColumn, which moves the cells with their column); a row moves
  // only within its own table (its cells are bound to that table's column
  // identities).
  if (type === "table-cell") {
    const samePosition = fromChildren === toChildren && insertAt === fromIndex;
    if (!samePosition) {
      const tableId = findParent(ydoc, fromParent);
      const cols = tableId !== null ? readCols(ydoc, tableId) : null;
      throw new InvalidOperationError(
        `Cell "${id}" is bound to its column (position ${fromIndex} of ${cols ?? "?"}) and cannot move: a cell move would desync the row from the table's columnOrder. Column order is managed by moveTableColumn (the cells move with their column).`
      );
    }
  }
  if (type === "table-row" && toParent !== fromParent) {
    const rowCells = childrenOf(ydoc, id);
    const cellCount = rowCells !== null ? rowCells.toArray().length : 0;
    const targetCols = readCols(ydoc, toParent);
    throw new InvalidOperationError(
      `Row "${id}" cannot move between tables: it has ${cellCount} cell(s) against table "${toParent}"'s ${targetCols ?? "?"} column(s), and its cells are bound to the source table's columnOrder identities.`
    );
  }

  localTransact(ydoc, () => {
    fromChildren.delete(fromIndex, 1);
    toChildren.insert(insertAt, [id]);
    // The owner parent: the single CRDT-resolved ownership stand. A
    // concurrent move of the same block into a different container resolves
    // to one owner (the field) instead of a duplicate reference in two
    // arrays.
    const blockMap = getBlockMap(ydoc, id);
    if (blockMap !== null) blockMap.set("parent", toParent);
    // The canvas z-order mirror: a surface move reorders the canvas elements
    // (the children order is the z-order) — refresh the dense zIndex in the
    // affected surface(s) so the index stays consistent with the order.
    if (blockTypeOf(ydoc, toParent) === "surface") refreshSurfaceZIndex(ydoc, toParent);
    if (fromParent !== toParent && blockTypeOf(ydoc, fromParent) === "surface") {
      refreshSurfaceZIndex(ydoc, fromParent);
    }
  });
}

/** Removes a block and its whole subtree from the blocks map and parents. */
function removeBlock(ydoc: Y.Doc, id: string): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (type === "root") throw new InvalidOperationError("The root block cannot be removed.");

  const parentId = findParent(ydoc, id);

  // The flat page model: a page block's subtree is its derived segment —
  // the contiguous stretch to the first block with an indent <= its own —
  // removed with the block, like structural children. Extended BEFORE the
  // structural walk so the segment members' own structural descendants
  // (a table's rows/cells, a frame's page) are collected too.
  const segment: string[] = [];
  if (parentId !== null && isPageSequence(ydoc, parentId)) {
    const seq = childrenOf(ydoc, parentId);
    if (seq !== null) {
      const childIds = seq.toArray();
      const startIndex = childIds.indexOf(id);
      const ownIndent = indentOfBlock(ydoc, id);
      for (let i = startIndex + 1; i < childIds.length; i++) {
        const next = childIds[i];
        if (next === undefined || indentOfBlock(ydoc, next) <= ownIndent) break;
        segment.push(next);
      }
    }
  }

  const subtree: string[] = [id, ...segment];
  const stack = [id, ...segment];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    const children = childrenOf(ydoc, current);
    if (children === null) continue;
    for (const child of children.toArray()) {
      // A concurrent move can leave a phantom (the id in `current`'s array,
      // owned by another container per the parent field) — it is not part
      // of `current`'s subtree and must not be deleted with it.
      if (findParent(ydoc, child) !== current) continue;
      subtree.push(child);
      stack.push(child);
    }
  }

  const parentChildren = parentId === null ? null : childrenOf(ydoc, parentId);

  // A full row cannot drop a cell (it would leave a valid doc invalid); an
  // incomplete row may be repaired.
  if (type === "table-cell" && parentChildren !== null) {
    const cellCount = parentChildren.toArray().length;
    const tableId = parentId !== null ? findParent(ydoc, parentId) : null;
    const cols = tableId !== null ? readCols(ydoc, tableId) : null;
    if (cols !== null && cellCount === cols) {
      throw new InvalidOperationError(
        `Row "${parentId}" has ${cellCount} of ${cols} cells; a full row cannot drop a cell.`
      );
    }
  }

  localTransact(ydoc, () => {
    if (parentChildren !== null) {
      // Every subtree entry the parent's sequence holds — the direct id for
      // structural parents, the whole derived segment for a page sequence —
      // is removed from the array (tail-first, so the lower indices stay).
      const current = parentChildren.toArray();
      const indices = subtree
        .map((blockId) => current.indexOf(blockId))
        .filter((index) => index !== -1)
        .sort((x, y) => y - x);
      for (const index of indices) parentChildren.delete(index, 1);
    }
    // The canvas z-order mirror: a surface removal leaves a gap in the dense
    // zIndex — re-densify the remaining canvas elements (1..N, no gaps).
    if (parentId !== null && blockTypeOf(ydoc, parentId) === "surface") {
      refreshSurfaceZIndex(ydoc, parentId);
    }
    const blocks = getBlocks(ydoc);
    for (const blockId of subtree) blocks.delete(blockId);
  });
}

export { blockTypeOf, childrenOf, findParent, getBlockMap, insertBlock, moveBlock, removeBlock };
export type { InsertBlockArgs, InsertBlockPosition };
