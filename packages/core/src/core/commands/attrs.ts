/**
 * The attribute/title write commands: updateBlock, setTitle. A command
 * validates first (typed errors, no silent no-ops) and then mutates in one
 * transaction with the local origin.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateBlockAttrs, validateCanvasBlock } from "@docblocks-core/schema";
import type { BlockAttrsPatch, ValidationError } from "@docblocks-core/schema";

import { InvalidAttrsError, InvalidOperationError, UnknownBlockError, formatValidationErrors } from "../errors";
import { localTransact, writeAttrValue } from "../layout";
import { readBlock } from "../read";
import { assertValidDatabasePatch } from "./database";
import { blockTypeOf, childrenOf, findParent, getBlockMap, indentJumpViolation, isPageSequence } from "./structure";

/** Sets or overwrites the given attrs; other attrs stay, attrs are never removed. */
function updateBlock(ydoc: Y.Doc, id: string, patch: BlockAttrsPatch): void {
  const type = blockTypeOf(ydoc, id);
  if (type === null) throw new UnknownBlockError(`Unknown block "${id}".`);
  if (BLOCK_REGISTRY[type].attrs === undefined) throw new InvalidAttrsError(`Block type "${type}" has no attributes.`);

  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  if (entries.length === 0) return; // no-op

  // Validate the post-patch attrs as a whole (current attrs + patch) so the
  // registry rules and messages are reused as-is.
  const snapshot = readBlock(ydoc, id);
  const current = snapshot !== null && "attrs" in snapshot ? snapshot.attrs : undefined;
  const merged: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current ?? {})) merged[key] = value;
  for (const [key, value] of entries) merged[key] = value;
  const errors = validateBlockAttrs(type, merged);
  if (errors.length > 0) {
    throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${formatValidationErrors(errors)}`);
  }

  // A table's `cols` must stay equal to every existing row's cell count; a
  // table with no rows accepts any valid value.
  if (type === "table" && patch.cols !== undefined) {
    const rows = childrenOf(ydoc, id);
    for (const rowId of rows !== null ? rows.toArray() : []) {
      const cells = childrenOf(ydoc, rowId);
      const count = cells !== null ? cells.toArray().length : 0;
      if (count !== patch.cols) {
        throw new InvalidOperationError(
          `New cols ${patch.cols} does not match row "${rowId}" (it has ${count} cells).`
        );
      }
    }
  }

  // A database's post-patch columns must keep the strict invariants against
  // the existing rows (like a table's cols against its row cell counts);
  // a post-patch `tableId` (the external form) must keep them too — the
  // inline form's columns cannot stand next to the reference.
  if (type === "database" && (patch.columns !== undefined || patch.tableId !== undefined)) {
    assertValidDatabasePatch(snapshot, merged, id);
  }

  // A canvas type's post-patch attrs must keep the block-level invariants
  // (the points tuples, the connector refs) — like the database's patch
  // check against its existing rows.
  if (type === "shape" || type === "connector") {
    const canvasErrors: ValidationError[] = [];
    validateCanvasBlock(type, { type, attrs: merged }, `blocks.${id}`, canvasErrors);
    if (canvasErrors.length > 0) {
      throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${formatValidationErrors(canvasErrors)}`);
    }
  }

  // The flat page model: a post-patch indent must keep the
  // sequence's jump rule (the validator enforces it at load; the commands
  // keep a live document valid too).
  if (merged.indent !== undefined) {
    const parent = findParent(ydoc, id);
    if (parent !== null && isPageSequence(ydoc, parent)) {
      const seq = childrenOf(ydoc, parent);
      const childIds = seq !== null ? seq.toArray() : [];
      const violation = indentJumpViolation(ydoc, childIds, childIds.indexOf(id), merged.indent as number);
      if (violation !== null) {
        throw new InvalidAttrsError(`Invalid attrs for block "${id}": ${violation}.`);
      }
    }
  }

  localTransact(ydoc, () => {
    const block = getBlockMap(ydoc, id);
    if (block === null) return;
    const existing = block.get("attrs");
    const attrsMap = existing instanceof Y.Map ? existing : new Y.Map<unknown>();
    if (!(existing instanceof Y.Map)) block.set("attrs", attrsMap);
    for (const [key, value] of entries) writeAttrValue(attrsMap, key, value);
  });
}

/** Replaces the whole document title. */
function setTitle(ydoc: Y.Doc, text: string): void {
  localTransact(ydoc, () => {
    const meta = ydoc.getMap("meta");
    const title = meta.get("title");
    if (title instanceof Y.Text) {
      title.delete(0, title.length);
      title.insert(0, text);
    } else {
      meta.set("title", new Y.Text(text));
    }
  });
}

export { setTitle, updateBlock };
