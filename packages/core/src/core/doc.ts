import * as Y from "yjs";

import { validateDoc } from "@docblocks-core/schema";
import type {
  Block,
  BlockAttrsPatch,
  BlockId,
  BlockType,
  DatabaseCellValue,
  DocJSON,
  DocMeta,
  Geometry,
  MarkName,
  MarkSet,
  TextRun,
} from "@docblocks-core/schema";

import { setTitle as setTitleCommand, updateBlock as updateBlockCommand } from "./commands/attrs";
import {
  insertBlock as insertBlockCommand,
  moveBlock as moveBlockCommand,
  removeBlock as removeBlockCommand,
} from "./commands/blocks";
import type { InsertBlockArgs } from "./commands/blocks";
import {
  insertRow as insertRowCommand,
  moveRow as moveRowCommand,
  removeRow as removeRowCommand,
  setCell as setCellCommand,
} from "./commands/database";
import { setGeometry as setGeometryCommand } from "./commands/geometry";
import { setMark as setMarkCommand, unsetMark as unsetMarkCommand } from "./commands/marks";
import type { MarkInput } from "./commands/marks";
import { deleteText as deleteTextCommand, insertText as insertTextCommand } from "./commands/text";
import { InvalidSnapshotError, formatValidationErrors } from "./errors";
import { observeText as observeDocText, onBlock as onDocBlock, onChange as onDocChange } from "./events";
import type { Change } from "./events";
import { undoManagerOf } from "./history";
import { layoutDoc, loadOriginOf, localTransact, writeDocument } from "./layout";
import { readBlock, readChildren, readMeta, readRuns, readText, toDocJSON } from "./read";

const randomId = (): string => crypto.randomUUID();

/** Options for createDoc: document identity and metadata (all optional). */
interface CreateDocOptions {
  /** Document id; defaults to a generated id (see `generateId`). */
  id?: BlockId;
  title?: string;
  /** ISO 8601; defaults to the current time. */
  createdAt?: string;
  /** Document id generator; defaults to randomUUID. */
  generateId?: () => string;
}

/**
 * A document: the live CRDT version of a schema JSON snapshot.
 *
 * Reads return plain snapshots (never Yjs types). CRDT-level API for
 * sync and power users: encode / encodeUpdate / applyUpdate; `raw` is
 * an explicit escape hatch and is not part of the stability contract.
 */
class Doc {
  readonly #ydoc: Y.Doc;
  /** Generator for new block ids (see `createDoc` options). */
  readonly #generateId: () => string;

  private constructor(ydoc: Y.Doc, generateId: () => string) {
    this.#ydoc = ydoc;
    this.#generateId = generateId;
    // Created after the initial state exists: loaded/imported state is not
    // undoable (its load origin is never tracked).
    undoManagerOf(ydoc);
  }

  /** Factory for a new document (see createDoc). */
  static create(options: CreateDocOptions = {}): Doc {
    const generateId = options.generateId ?? randomId;
    const id = options.id ?? generateId();
    const title = options.title ?? "";
    const createdAt = options.createdAt ?? new Date().toISOString();
    return new Doc(layoutDoc(id, title, createdAt), generateId);
  }

  /** Factory for a document restored from a CRDT snapshot (see loadDoc). */
  static load(bytes: Uint8Array): Doc {
    const ydoc = new Y.Doc();
    try {
      Y.applyUpdate(ydoc, bytes, loadOriginOf(ydoc));
    } catch (error) {
      throw new InvalidSnapshotError(
        `loadDoc: malformed update bytes: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    // A full snapshot is the only loadable state: an incremental delta applied
    // to an empty doc yields a partial document, so validate it loudly.
    const errors = validateDoc(toDocJSON(ydoc));
    if (errors.length > 0) {
      throw new InvalidSnapshotError(
        `loadDoc expects a full document snapshot; got an incomplete or invalid state: ${formatValidationErrors(errors)}`
      );
    }
    return new Doc(ydoc, randomId);
  }

  /** Factory for a document built from schema JSON (see fromJSON). */
  static fromJSON(json: DocJSON): Doc {
    const errors = validateDoc(json);
    if (errors.length > 0) throw errors;
    const ydoc = new Y.Doc();
    writeDocument(ydoc, json);
    return new Doc(ydoc, randomId);
  }

  /** Escape hatch: the underlying Y.Doc. Not guaranteed to stay. */
  get raw(): Y.Doc {
    return this.#ydoc;
  }

  /** Document metadata, read live (no Yjs-internal fields). */
  get meta(): DocMeta {
    return readMeta(this.#ydoc);
  }

  /** Snapshot of a block; null when the block is missing. */
  getBlock(id: BlockId): Block | null {
    return readBlock(this.#ydoc, id);
  }

  /** Ordered child ids; [] for non-containers and missing blocks. */
  getChildren(id: BlockId): BlockId[] {
    return readChildren(this.#ydoc, id);
  }

  /** Normalized runs; [] for non-text types and missing blocks. */
  getRuns(blockId: BlockId): TextRun[] {
    return readRuns(this.#ydoc, blockId);
  }

  /** Flattened run text; "" for non-text types and missing blocks. */
  getText(blockId: BlockId): string {
    return readText(this.#ydoc, blockId);
  }

  /** Flattened text length (the offset boundary for text commands). */
  getTextLength(blockId: BlockId): number {
    return readText(this.#ydoc, blockId).length;
  }

  // ---- semantic commands: the only path for normal editing ----

  /** Inserts a new block and returns its id (typed attrs per block type). */
  insertBlock<T extends BlockType>(...args: InsertBlockArgs<T>): BlockId {
    const [type, attrs, at] = args;
    return insertBlockCommand(this.#ydoc, this.#generateId, type, attrs, at);
  }

  /** Sets or overwrites the given attrs of a block. */
  updateBlock(id: BlockId, patch: BlockAttrsPatch): void {
    updateBlockCommand(this.#ydoc, id, patch);
  }

  /** Moves a block to `toIndex` under `toParent` (pre-move index semantics). */
  moveBlock(id: BlockId, toParent: BlockId, toIndex: number): void {
    moveBlockCommand(this.#ydoc, id, toParent, toIndex);
  }

  /** Removes a block and its whole subtree. */
  removeBlock(id: BlockId): void {
    removeBlockCommand(this.#ydoc, id);
  }

  /** Replaces the document title. */
  setTitle(text: string): void {
    setTitleCommand(this.#ydoc, text);
  }

  /** Appends an empty row to a database block and returns its row id. */
  insertRow(databaseId: BlockId): BlockId {
    return insertRowCommand(this.#ydoc, this.#generateId, databaseId);
  }

  /** Sets the cell value of a database row, validated against the column type. */
  setCell(databaseId: BlockId, rowId: string, colId: string, value: DatabaseCellValue | undefined): void {
    setCellCommand(this.#ydoc, databaseId, rowId, colId, value);
  }

  /** Removes a database row: its cells entry and its rowOrder entry. */
  removeRow(databaseId: BlockId, rowId: string): void {
    removeRowCommand(this.#ydoc, databaseId, rowId);
  }

  /** Moves a database row to `toIndex` (pre-move index semantics). */
  moveRow(databaseId: BlockId, rowId: string, toIndex: number): void {
    moveRowCommand(this.#ydoc, databaseId, rowId, toIndex);
  }

  /**
   * Sets the canvas geometry of a block: a partial patch merges with the
   * existing geometry (the result must be complete — x/y/w/h present),
   * `null` removes the geometry. InvalidGeometryError on a bad value or an
   * incomplete merge; an equal-value set is a no-op.
   */
  setGeometry(id: BlockId, geometry: Partial<Geometry> | null): void {
    setGeometryCommand(this.#ydoc, id, geometry);
  }

  /** Inserts text at character offset `pos`, optionally carrying marks. */
  insertText(blockId: BlockId, pos: number, text: string, marks?: MarkSet): void {
    insertTextCommand(this.#ydoc, blockId, pos, text, marks);
  }

  /** Deletes the text range [from, to). */
  deleteText(blockId: BlockId, from: number, to: number): void {
    deleteTextCommand(this.#ydoc, blockId, from, to);
  }

  /** Applies a mark to the text range [from, to). */
  setMark(blockId: BlockId, from: number, to: number, mark: MarkInput): void {
    setMarkCommand(this.#ydoc, blockId, from, to, mark);
  }

  /** Removes a mark from the text range [from, to). */
  unsetMark(blockId: BlockId, from: number, to: number, name: MarkName): void {
    unsetMarkCommand(this.#ydoc, blockId, from, to, name);
  }

  /** The document as plain schema JSON (export normalization applied). */
  toJSON(): DocJSON {
    return toDocJSON(this.#ydoc);
  }

  /** Compact full state (a snapshot). */
  encode(): Uint8Array {
    return Y.encodeStateAsUpdate(this.#ydoc);
  }

  /** Delta state: only what the holder of `stateVector` is missing. */
  encodeUpdate(stateVector?: Uint8Array): Uint8Array {
    return Y.encodeStateAsUpdate(this.#ydoc, stateVector);
  }

  /** Apply a remote update (no local origin). */
  applyUpdate(bytes: Uint8Array): void {
    Y.applyUpdate(this.#ydoc, bytes);
  }

  // ---- transactions, undo/redo, reactivity ----

  /**
   * Run `fn` as one local transaction: one Yjs update and one undo step,
   * however many commands `fn` runs (commands join this transaction).
   * If `fn` throws, the batch's changes are rolled back and the error
   * propagates. A failed batch still emits a transient `onChange` emission
   * and a partial wire update before the rollback (CRDT property: the
   * rollback is best-effort on the wire; observable state converges).
   */
  transact(fn: () => void): void {
    const ydoc = this.#ydoc;
    const manager = undoManagerOf(ydoc);
    const undoDepth = manager.undoStack.length;
    try {
      localTransact(ydoc, fn);
    } catch (error) {
      // Y.Doc has no transaction abort: a mid-batch throw leaves the batch's
      // changes committed. They were captured as an undo step; undoing it
      // restores the pre-batch state. A delta of exactly one means no other
      // transaction ran in the meantime (e.g. from a listener); otherwise
      // rolling back would also revert unrelated edits.
      const captured = manager.undoStack.length - undoDepth;
      if (captured === 1) {
        // The rollback's undo() puts the batch's inverse step on the redo
        // stack; drop it so redo cannot resurrect the failed batch. Pre-
        // existing redo entries are already gone: capturing the failed batch
        // invalidated them.
        manager.undo();
        manager.clear(false, true);
      }
      throw error;
    }
  }

  /** Undo the last local edit; a safe no-op when there is nothing to undo. */
  undo(): void {
    undoManagerOf(this.#ydoc).undo();
  }

  /** Redo the last undone local edit; a safe no-op when the stack is empty. */
  redo(): void {
    undoManagerOf(this.#ydoc).redo();
  }

  /** Whether there is a local edit to undo. */
  get canUndo(): boolean {
    return undoManagerOf(this.#ydoc).canUndo();
  }

  /** Whether there is an undone local edit to redo. */
  get canRedo(): boolean {
    return undoManagerOf(this.#ydoc).canRedo();
  }

  /**
   * Subscribe to document changes — local and remote, one emission per
   * transaction. Fires before the per-block subscriptions of the same
   * transaction. Returns an unsubscribe function (safe to call twice).
   */
  onChange(handler: (change: Change) => void): () => void {
    return onDocChange(this.#ydoc, handler);
  }

  /**
   * Subscribe to one block: fires with a fresh snapshot whenever the block
   * is in `change.blockIds` and still exists (a removed block emits nothing
   * — removals are visible via `onChange`). Returns an unsubscribe function.
   */
  onBlock(id: BlockId, handler: (block: Block) => void): () => void {
    return onDocBlock(this.#ydoc, id, handler);
  }

  /**
   * Subscribe to the flattened text of a block: fires on any change of the
   * block with the current text (a redundant equal value is possible; a
   * removed block reports ""). Returns an unsubscribe function.
   */
  observeText(blockId: BlockId, handler: (text: string) => void): () => void {
    return observeDocText(this.#ydoc, blockId, handler);
  }
}

/**
 * Create a new document. Initial state: only the root block (empty page),
 * whose id equals the document id. No auto first paragraph.
 */
function createDoc(options: CreateDocOptions = {}): Doc {
  return Doc.create(options);
}

/**
 * Restore a document from a CRDT snapshot.
 *
 * Expects a FULL snapshot state and throws InvalidSnapshotError otherwise
 * (e.g. on an incremental diff): a delta applied to an empty doc is a silent
 * partial document, so the state is validated on load. The consumer pattern
 * for a base + diffs is `loadDoc(base)` followed by `applyUpdate(diff)`.
 */
function loadDoc(bytes: Uint8Array): Doc {
  return Doc.load(bytes);
}

/**
 * Build a document from schema JSON. Validates first and throws the
 * ValidationError list as-is on violations. Runs are written as given.
 */
function fromJSON(json: DocJSON): Doc {
  return Doc.fromJSON(json);
}

export { Doc, createDoc, fromJSON, loadDoc };
export type { CreateDocOptions };
