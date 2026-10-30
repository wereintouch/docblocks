/** The selection's validation + normalization helpers: the text-point
 *  validation, the selection normalization, the reading-order chain, the
 *  clone, and the structural equality. */
import { BLOCK_REGISTRY } from "@docblocks-core/schema";
import type { BlockId } from "@docblocks-core/schema";

import type { Doc } from "../doc";
import { InvalidSelectionError } from "../errors";
import type { Selection, TextPoint } from "./models";
import { chainBetween, linearize } from "./rebase";

/** Validate a text point against the document; throws InvalidSelectionError. */
function validateTextPoint(doc: Doc, point: unknown, label: string): TextPoint {
  if (point === null || typeof point !== "object") throw new InvalidSelectionError(`${label} must be a text point.`);
  const { blockId, offset } = point as { blockId?: unknown; offset?: unknown };
  if (typeof blockId !== "string") throw new InvalidSelectionError(`${label}.blockId must be a string.`);
  const block = doc.getBlock(blockId);
  if (block === null) throw new InvalidSelectionError(`${label} references unknown block "${blockId}".`);
  if (!BLOCK_REGISTRY[block.type].content) {
    throw new InvalidSelectionError(`${label} block "${blockId}" (type "${block.type}") has no text content.`);
  }
  if (typeof offset !== "number" || !Number.isInteger(offset)) {
    throw new InvalidSelectionError(`${label}.offset must be an integer.`);
  }
  const length = doc.getTextLength(blockId);
  if (offset < 0 || offset > length) {
    throw new InvalidSelectionError(`${label}.offset ${offset} is outside [0, ${length}] of block "${blockId}".`);
  }
  return { blockId, offset };
}

/** Validate and normalize a selection into a stored (engine-filled) form. */
function normalizeSelection(doc: Doc, selection: Selection): Selection {
  if (typeof selection !== "object" || selection === null) {
    throw new InvalidSelectionError("Selection must be an object.");
  }
  const { kind } = selection;
  if (kind === "none") return { kind: "none" };

  if (kind === "text") {
    const from = validateTextPoint(doc, selection.from, "from");
    const to = selection.to === null ? null : validateTextPoint(doc, selection.to, "to");
    const blocks =
      to === null || to.blockId === from.blockId ? [from.blockId] : chainFor(doc, from.blockId, to.blockId);
    // A provided chain is validated against the computed one (no silent fix).
    if (selection.blocks !== undefined) {
      if (selection.blocks.length !== blocks.length || selection.blocks.some((id, i) => id !== blocks[i])) {
        throw new InvalidSelectionError(`Cross-block chain does not match the document order.`);
      }
    }
    const next: Selection = { kind: "text", from, to, blocks };
    if (typeof selection.reverse === "boolean") next.reverse = selection.reverse;
    return next;
  }

  if (kind === "blocks") {
    if (!Array.isArray(selection.ids) || selection.ids.length === 0) {
      throw new InvalidSelectionError("A blocks selection needs a non-empty ids list.");
    }
    for (const id of selection.ids) {
      if (typeof id !== "string" || doc.getBlock(id) === null) {
        throw new InvalidSelectionError(`A blocks selection references unknown block "${String(id)}".`);
      }
    }
    if (typeof selection.anchorId !== "string" || !selection.ids.includes(selection.anchorId)) {
      throw new InvalidSelectionError(`A blocks selection anchorId must be one of its ids.`);
    }
    return { kind: "blocks", ids: [...selection.ids], anchorId: selection.anchorId };
  }

  throw new InvalidSelectionError(`Unknown selection kind "${String(kind)}".`);
}

/** The reading-order chain of a cross-block selection; throws when a block is unreachable. */
function chainFor(doc: Doc, fromId: BlockId, toId: BlockId): BlockId[] {
  const chain = chainBetween(linearize(doc), fromId, toId);
  if (chain === null) {
    throw new InvalidSelectionError(`Cross-block selection: block "${toId}" is not reachable from the root.`);
  }
  return chain;
}

function cloneSelection(state: Selection): Selection {
  if (state.kind === "none") return { kind: "none" };
  if (state.kind === "blocks") return { kind: "blocks", ids: [...state.ids], anchorId: state.anchorId };
  return {
    kind: "text",
    from: { blockId: state.from.blockId, offset: state.from.offset },
    to: state.to === null ? null : { blockId: state.to.blockId, offset: state.to.offset },
    blocks: [...(state.blocks ?? [])],
    ...(state.reverse !== undefined ? { reverse: state.reverse } : {}),
  };
}

/** Structural equality (drives the rebase emission: no-op changes emit nothing). */
function selectionsEqual(a: Selection, b: Selection): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "none") return true;
  if (a.kind === "blocks" && b.kind === "blocks") {
    return a.anchorId === b.anchorId && a.ids.length === b.ids.length && a.ids.every((id, i) => id === b.ids[i]);
  }
  if (a.kind === "text" && b.kind === "text") {
    if (a.from.blockId !== b.from.blockId || a.from.offset !== b.from.offset) return false;
    if ((a.to === null) !== (b.to === null)) return false;
    if (a.to !== null && b.to !== null && (a.to.blockId !== b.to.blockId || a.to.offset !== b.to.offset)) return false;
    const ba = a.blocks ?? [];
    const bb = b.blocks ?? [];
    return ba.length === bb.length && ba.every((id, i) => id === bb[i]) && a.reverse === b.reverse;
  }
  return false;
}

export { chainFor, cloneSelection, normalizeSelection, selectionsEqual, validateTextPoint };
