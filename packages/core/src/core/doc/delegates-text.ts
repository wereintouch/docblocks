/**
 * The Doc facade's text delegates: the command calls behind the text edit,
 * mark, and cross-block range methods.
 */
import type * as Y from "yjs";

import type { BlockId, MarkName, MarkSet } from "@docblocks-core/schema";

import {
  deleteText as deleteTextCommand,
  deleteTextRange as deleteTextRangeCommand,
  insertText as insertTextCommand,
  setMark as setMarkCommand,
  setMarkRange as setMarkRangeCommand,
  unsetMark as unsetMarkCommand,
} from "../commands";
import type { MarkInput } from "../commands";
import type { TextPoint } from "../selection";

/** Inserts text at character offset `pos`, optionally carrying marks. */
function insertText(ydoc: Y.Doc, blockId: BlockId, pos: number, text: string, marks?: MarkSet): void {
  insertTextCommand(ydoc, blockId, pos, text, marks);
}

/** Deletes the text range [from, to). */
function deleteText(ydoc: Y.Doc, blockId: BlockId, from: number, to: number): void {
  deleteTextCommand(ydoc, blockId, from, to);
}

/** Applies a mark to the text range [from, to). */
function setMark(ydoc: Y.Doc, blockId: BlockId, from: number, to: number, mark: MarkInput): void {
  setMarkCommand(ydoc, blockId, from, to, mark);
}

/** Removes a mark from the text range [from, to). */
function unsetMark(ydoc: Y.Doc, blockId: BlockId, from: number, to: number, name: MarkName): void {
  unsetMarkCommand(ydoc, blockId, from, to, name);
}

/**
 * Deletes the cross-block text range [from, to) and returns the caret
 * seam (the point the caret lands on); null when the document carries
 * no text left. Same-block ranges delegate to deleteText.
 */
function deleteTextRange(ydoc: Y.Doc, from: TextPoint, to: TextPoint): TextPoint | null {
  return deleteTextRangeCommand(ydoc, from, to);
}

/**
 * Applies a mark to the cross-block text range [from, to): the per-block
 * segments of the range's DFS chain, in one transaction. Same-block
 * ranges delegate to setMark.
 */
function setMarkRange(ydoc: Y.Doc, from: TextPoint, to: TextPoint, mark: MarkInput): void {
  setMarkRangeCommand(ydoc, from, to, mark);
}

export { deleteText, deleteTextRange, insertText, setMark, setMarkRange, unsetMark };
