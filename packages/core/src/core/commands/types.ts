/**
 * The block type transition command: changeBlockType. A command validates
 * first (typed errors, no silent no-ops) and then mutates in one
 * transaction with the local origin.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateBlockAttrs, validateCanvasBlock } from "@docblocks-core/schema";
import type { AttrsFor, BlockId, BlockType, ValidationError } from "@docblocks-core/schema";

import {
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  UnknownBlockError,
  UnknownBlockTypeError,
  formatValidationErrors,
} from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readBlock } from "../read";
import { assertValidDatabaseInsert } from "./database";
import { blockTypeOf, childrenOf, findParent, getBlockMap, indentJumpViolation } from "./structure";
import { refreshSurfaceZIndex } from "./z-order";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Argument tuple of `changeBlockType`: the target's attrs are passed whole
 * (required ones included); they are optional only for types whose attrs
 * are all optional.
 */
type ChangeBlockTypeArgs<T extends BlockType> =
  undefined extends AttrsFor<T>
    ? [id: BlockId, type: T, attrs?: AttrsFor<T>]
    : [id: BlockId, type: T, attrs: AttrsFor<T>];

/**
 * Changes a block's type. The content must survive (both types carry it),
 * the children must fit the target's children rules, the new type must
 * fit the block's parent, and the post-change attrs must satisfy the
 * target's required attrs: the current attrs the target also declares are
 * carried over, the patch overrides them, and type-specific attrs are
 * dropped.
 */
function changeBlockType(ydoc: Y.Doc, id: string, type: BlockType, attrs: unknown): void {
  const currentType = blockTypeOf(ydoc, id);
  if (currentType === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (currentType === "root") throw new InvalidOperationError("The root block's type cannot be changed.");
  if (!(type in BLOCK_REGISTRY)) throw new UnknownBlockTypeError(`Unknown block type "${String(type)}".`);
  if (type === currentType) throw new InvalidOperationError(`Block "${id}" is already of type "${type}".`);

  const from = BLOCK_REGISTRY[currentType];
  const to = BLOCK_REGISTRY[type];

  // The text content must survive the transition: a contentful type never
  // becomes a contentless one (the runs would be lost) and vice versa the
  // new content array is created empty below.
  if (from.content && !to.content) {
    throw new InvalidOperationError(`Block type "${currentType}" cannot become "${type}" (the content would be lost).`);
  }

  // The children must fit the target: a container never becomes a leaf
  // (the subtree would be lost), and every current child must be an
  // allowed type of the target.
  const currentChildren = childrenOf(ydoc, id);
  const childIds = currentChildren !== null ? currentChildren.toArray() : [];
  if (childIds.length > 0) {
    if (!to.children) {
      throw new InvalidOperationError(`Block "${id}" has children; type "${type}" cannot have children.`);
    }
    for (const childId of childIds) {
      const childType = blockTypeOf(ydoc, childId);
      if (childType === null || !to.childrenTypes?.includes(childType)) {
        throw new InvalidOperationError(
          `Block "${childId}" (type "${childType ?? "?"}") is not allowed under type "${type}".`
        );
      }
    }
  }

  // The new type must fit the block's parent (the same rule insertBlock
  // enforces for the initial type).
  const parentId = findParent(ydoc, id);
  if (parentId === null) throw new InvalidOperationError(`Block "${id}" has no parent.`);
  const parentType = blockTypeOf(ydoc, parentId);
  const parentSpec = parentType === null ? null : BLOCK_REGISTRY[parentType];
  if (parentSpec === null || !parentSpec.children || !parentSpec.childrenTypes?.includes(type)) {
    throw new InvalidChildError(`Block type "${type}" is not allowed as a child of "${parentType ?? "?"}".`);
  }

  // The rows data must survive the transition like the content: a
  // rows-carrying block never becomes a rows-less one while it holds rows
  // (the rows would be lost) and vice versa fresh empty rows are created
  // below.
  if (!to.rows && from.rows) {
    const block = getBlockMap(ydoc, id);
    const rows = block !== null ? block.get("rows") : null;
    if (rows instanceof Y.Map && rows.size > 0) {
      throw new InvalidOperationError(`Block "${id}" has rows; type "${type}" cannot have rows.`);
    }
  }

  // The post-change attrs: the current attrs the target also declares
  // (the target spec is the whitelist), overridden by the patch.
  const snapshot = readBlock(ydoc, id);
  const currentAttrs = snapshot !== null && "attrs" in snapshot ? snapshot.attrs : undefined;
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(currentAttrs ?? {})) {
    if (to.attrs !== undefined && key in to.attrs) merged[key] = value;
  }
  for (const [key, value] of Object.entries(isPlainObject(attrs) ? attrs : {})) {
    if (value !== undefined) merged[key] = value;
  }
  if (to.attrs !== undefined) {
    const errors = validateBlockAttrs(type, merged);
    if (errors.length > 0) {
      throw new InvalidAttrsError(
        `Invalid attrs for type "${type}" on block "${id}": ${formatValidationErrors(errors)}`
      );
    }
  } else if (Object.keys(merged).length > 0) {
    throw new InvalidAttrsError(`Block type "${type}" has no attributes.`);
  }

  // The flat page model: the post-change indent must keep the sequence's
  // jump rule at the block's position (the position itself does not move).
  if (parentSpec.sequence === true) {
    const seq = childrenOf(ydoc, parentId);
    const childIds = seq !== null ? seq.toArray() : [];
    const newIndent = typeof merged.indent === "number" ? merged.indent : 0;
    const violation = indentJumpViolation(ydoc, childIds, childIds.indexOf(id), newIndent);
    if (violation !== null) {
      throw new InvalidAttrsError(`Invalid attrs for type "${type}" on block "${id}": ${violation}.`);
    }
  }

  // The block-level invariants the registry attrs spec does not express:
  // the database's column rules (the options presence, the duplicate ids)
  // and the canvas's block-level invariants (the points tuples, the
  // connector refs) — like insertBlock checks them on its post-insert attrs.
  if (type === "database") {
    assertValidDatabaseInsert(merged);
  }
  if (type === "shape" || type === "connector") {
    const canvasErrors: ValidationError[] = [];
    validateCanvasBlock(type, { type, attrs: merged }, `blocks.${id}`, canvasErrors);
    if (canvasErrors.length > 0) {
      throw new InvalidAttrsError(
        `Invalid attrs for type "${type}" on block "${id}": ${formatValidationErrors(canvasErrors)}`
      );
    }
  }

  localTransact(ydoc, () => {
    const block = getBlockMap(ydoc, id);
    if (block === null) return;
    block.set("type", type);

    // Attrs are replaced whole: the old map is dropped, the merged set is
    // written (or the key deleted when the result is empty).
    if (Object.keys(merged).length > 0) {
      const attrsMap = new Y.Map<unknown>();
      for (const [key, value] of Object.entries(merged)) writeAttrValue(attrsMap, key, value);
      block.set("attrs", attrsMap);
    } else {
      block.delete("attrs");
    }

    // The content array survives the transition (both types carry it) or
    // is created empty for a contentless -> contentful step.
    if (to.content && !from.content) block.set("content", new Y.Array<Y.Map<unknown>>());

    // The children array is created for a leaf -> container step and
    // deleted for a container -> leaf step (rejected above when non-empty).
    if (to.children && !from.children) block.set("children", new Y.Array<string>());
    if (!to.children && from.children) block.delete("children");

    // The rows data is created fresh for a rows-less -> rows step and
    // deleted for a rows -> rows-less step (rejected above when non-empty).
    if (to.rows && !from.rows) {
      block.set("rows", new Y.Map<unknown>());
      block.set("rowOrder", new Y.Array<string>());
    }
    if (!to.rows && from.rows) {
      block.delete("rows");
      block.delete("rowOrder");
    }

    // The surface's z-order (the dense zIndex over the canvas elements) must
    // stay consistent with the transition: the block leaves the index (the
    // attrs are replaced whole — the zIndex falls out) or enters it (the
    // index stands at the block's array position — the paint's stand).
    if (parentType === "surface") refreshSurfaceZIndex(ydoc, parentId);
  });
}

export { changeBlockType };
export type { ChangeBlockTypeArgs };
