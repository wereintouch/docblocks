/**
 * Text commands: insertText, deleteText.
 *
 * The text content is a single `Y.Text`; offsets are character indices into
 * it. Marks are the Y.Text's per-character attributes (the mark commands set
 * them with `format`/`unformat`, so they never copy text — the CRDT-safe stand
 * for the former run array). Offsets are in the raw text (normalization is
 * lazy at read time and never changes the length).
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateMarkSet } from "@docblocks-core/schema";
import type { BlockType, MarkSet } from "@docblocks-core/schema";

import {
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  formatValidationErrors,
} from "../errors";
import { localTransact } from "../layout";
import { markSetToAttrs } from "../text-model";
import { blockTypeOf, getBlockMap } from "./blocks";

/** A text block ready for editing: its type and content (the single Y.Text). */
interface TextContext {
  type: BlockType;
  content: Y.Text;
}

/** The target block must exist and carry text content; throws otherwise. */
function requireTextBlock(ydoc: Y.Doc, blockId: string): TextContext {
  const block = getBlockMap(ydoc, blockId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);
  const type = blockTypeOf(ydoc, blockId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);
  const noText = new InvalidOperationError(`Block "${blockId}" (type "${type}") has no text content.`);
  if (!BLOCK_REGISTRY[type].content) throw noText;
  const content = block.get("content");
  if (!(content instanceof Y.Text)) throw noText;
  return { type, content };
}

/** Flattened raw text length — the offset boundary for text commands. */
function contentTextLength(content: Y.Text): number {
  return content.length;
}

/**
 * Inserts `text` at character offset `pos`, carrying `marks` (default: none).
 * The characters take the given marks as their attributes (no exclusivity is
 * enforced on insert; the mark commands own that rule).
 */
function insertText(ydoc: Y.Doc, blockId: string, pos: number, text: string, marks: MarkSet = {}): void {
  const { type, content } = requireTextBlock(ydoc, blockId);
  const total = content.length;
  if (!Number.isInteger(pos) || pos < 0 || pos > total) {
    throw new InvalidRangeError(`pos must be an integer in [0, ${total}] (got ${pos}).`);
  }
  if (text === "") return; // no-op
  const markErrors = validateMarkSet(type, marks);
  if (markErrors.length > 0) {
    throw new InvalidMarkError(`Invalid marks for block "${blockId}": ${formatValidationErrors(markErrors)}`);
  }

  localTransact(ydoc, () => {
    // The attrs are always passed (even empty): a bare `insert` inherits the
    // preceding character's format, which the run model never did.
    const attrs = markSetToAttrs(marks);
    content.insert(pos, text, attrs);
  });
}

/**
 * Deletes the text range [from, to): a single Y.Text delete. `from === to` is
 * a no-op.
 */
function deleteText(ydoc: Y.Doc, blockId: string, from: number, to: number): void {
  const { content } = requireTextBlock(ydoc, blockId);
  const total = content.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to > total) {
    throw new InvalidRangeError(`Range must satisfy 0 <= from <= to <= ${total} (got from=${from}, to=${to}).`);
  }
  if (from === to) return; // no-op

  localTransact(ydoc, () => {
    content.delete(from, to - from);
  });
}

export { contentTextLength, deleteText, insertText, requireTextBlock };
