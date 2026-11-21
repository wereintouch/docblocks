/**
 * The Doc facade's passive surface: the snapshot reads, the CRDT
 * encode/apply, the undo/redo, and the change subscriptions.
 */
import * as Y from "yjs";

import type { Block, BlockId, DocJSON, DocMeta, TextRun } from "@docblocks-core/schema";

import {
  observeText as observeDocText,
  onBlock as onDocBlock,
  onChange as onDocChange,
  onRemoteChange as onDocRemoteChange,
} from "../events";
import type { Change } from "../events";
import { undoManagerOf } from "../history";
import { readBlock, readChildren, readMeta, readRuns, readText, toDocJSON } from "../read";

/** Document metadata, read live (no Yjs-internal fields). */
function meta(ydoc: Y.Doc): DocMeta {
  return readMeta(ydoc);
}

/** The last write stamp (ISO 8601): the Yjs-only `meta.updatedAt` field, deliberately excluded from the JSON meta. */
function lastUpdatedAt(ydoc: Y.Doc): string | null {
  const value = ydoc.getMap("meta").get("updatedAt");
  return typeof value === "string" ? value : null;
}

/** Snapshot of a block; null when the block is missing or its type is unknown (the opaque data stands in the export). */
function getBlock(ydoc: Y.Doc, id: BlockId): Block | null {
  return readBlock(ydoc, id);
}

/** Ordered child ids; [] for non-containers and missing blocks. */
function getChildren(ydoc: Y.Doc, id: BlockId): BlockId[] {
  return readChildren(ydoc, id);
}

/** Normalized runs; [] for non-text types and missing blocks. */
function getRuns(ydoc: Y.Doc, blockId: BlockId): TextRun[] {
  return readRuns(ydoc, blockId);
}

/** Flattened run text; "" for non-text types and missing blocks. */
function getText(ydoc: Y.Doc, blockId: BlockId): string {
  return readText(ydoc, blockId);
}

/** Flattened text length (the offset boundary for text commands). */
function getTextLength(ydoc: Y.Doc, blockId: BlockId): number {
  return readText(ydoc, blockId).length;
}

/** The document as plain schema JSON (export normalization applied). */
function toJSON(ydoc: Y.Doc): DocJSON {
  return toDocJSON(ydoc);
}

/** Compact full state (a snapshot). */
function encode(ydoc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc);
}

/** Delta state: only what the holder of `stateVector` is missing. */
function encodeUpdate(ydoc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc, stateVector);
}

/** Apply a remote update (no local origin). */
function applyUpdate(ydoc: Y.Doc, bytes: Uint8Array): void {
  Y.applyUpdate(ydoc, bytes);
}

/** Undo the last local edit; a safe no-op when there is nothing to undo. */
function undo(ydoc: Y.Doc): void {
  undoManagerOf(ydoc).undo();
}

/** Redo the last undone local edit; a safe no-op when the stack is empty. */
function redo(ydoc: Y.Doc): void {
  undoManagerOf(ydoc).redo();
}

/** Whether there is a local edit to undo. */
function canUndo(ydoc: Y.Doc): boolean {
  return undoManagerOf(ydoc).canUndo();
}

/** Whether there is an undone local edit to redo. */
function canRedo(ydoc: Y.Doc): boolean {
  return undoManagerOf(ydoc).canRedo();
}

/**
 * Subscribe to document changes — local and remote, one emission per
 * transaction. Fires before the per-block subscriptions of the same
 * transaction. Returns an unsubscribe function (safe to call twice).
 */
function onChange(ydoc: Y.Doc, handler: (change: Change) => void): () => void {
  return onDocChange(ydoc, handler);
}

/**
 * Subscribe to the non-local-origin changes (the wire's applies and the
 * escaped `raw` commits, one emission per transaction). Local
 * transactions — the commands, the undo manager — never emit here.
 * Returns an unsubscribe function (safe to call twice).
 */
function onRemoteChange(ydoc: Y.Doc, handler: (change: Change) => void): () => void {
  return onDocRemoteChange(ydoc, handler);
}

/**
 * Subscribe to one block: fires with a fresh snapshot whenever the block
 * is in `change.blockIds` and still exists (a removed block emits nothing
 * — removals are visible via `onChange`). Returns an unsubscribe function.
 */
function onBlock(ydoc: Y.Doc, id: BlockId, handler: (block: Block) => void): () => void {
  return onDocBlock(ydoc, id, handler);
}

/**
 * Subscribe to the flattened text of a block: fires on any change of the
 * block with the current text (a redundant equal value is possible; a
 * removed block reports ""). Returns an unsubscribe function.
 */
function observeText(ydoc: Y.Doc, blockId: BlockId, handler: (text: string) => void): () => void {
  return observeDocText(ydoc, blockId, handler);
}

export {
  applyUpdate,
  canRedo,
  canUndo,
  encode,
  encodeUpdate,
  getBlock,
  lastUpdatedAt,
  meta,
  getChildren,
  getRuns,
  getText,
  getTextLength,
  onBlock,
  onChange,
  onRemoteChange,
  observeText,
  redo,
  toJSON,
  undo,
};
