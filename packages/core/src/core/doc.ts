import * as Y from "yjs";

import { flattenDoc, normalizeZOrder, validateDoc } from "@docblocks-core/schema";
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

import {
  setAvatar as setAvatarCommand,
  setTitle as setTitleCommand,
  updateBlock as updateBlockCommand,
} from "./commands/attrs";
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
  setDatabaseTable as setDatabaseTableCommand,
} from "./commands/database";
import { setGeometry as setGeometryCommand } from "./commands/geometry";
import { setMark as setMarkCommand, unsetMark as unsetMarkCommand } from "./commands/marks";
import type { MarkInput } from "./commands/marks";
import {
  clearTableColumn as clearTableColumnCommand,
  clearTableRow as clearTableRowCommand,
  duplicateTableColumn as duplicateTableColumnCommand,
  duplicateTableRow as duplicateTableRowCommand,
  insertTableColumn as insertTableColumnCommand,
  insertTableRow as insertTableRowCommand,
  moveTableColumn as moveTableColumnCommand,
  moveTableRow as moveTableRowCommand,
  removeTableColumn as removeTableColumnCommand,
  removeTableRow as removeTableRowCommand,
  setTableColumnColor as setTableColumnColorCommand,
  setTableColumnWidth as setTableColumnWidthCommand,
  setTableRowColor as setTableRowColorCommand,
} from "./commands/table";
import { deleteText as deleteTextCommand, insertText as insertTextCommand } from "./commands/text";
import { deleteTextRange as deleteTextRangeCommand, setMarkRange as setMarkRangeCommand } from "./commands/text-range";
import { changeBlockType as changeBlockTypeCommand } from "./commands/types";
import type { ChangeBlockTypeArgs } from "./commands/types";
import { type ZOrderAction, setZOrder as setZOrderCommand } from "./commands/z-order";
import { InvalidSnapshotError, formatValidationErrors } from "./errors";
import {
  observeText as observeDocText,
  onBlock as onDocBlock,
  onChange as onDocChange,
  onRemoteChange as onDocRemoteChange,
} from "./events";
import type { Change } from "./events";
import { undoManagerOf } from "./history";
import { layoutDoc, loadOriginOf, localTransact, writeDocument } from "./layout";
import { readBlock, readChildren, readMeta, readRuns, readText, toDocJSON } from "./read";
import type { TextPoint } from "./selection";

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
    // The schema major (meta.v) stands checked on the RAW binary before any
    // conversion: the snapshot read stands the reader's own major, so a
    // stored v: 2 would pass the validator unseen and be read silently as
    // v1 — a reader of major N must never silently read N+1 data (the
    // breaking-major stand). A missing or non-numeric v is not valid v1
    // data either.
    const schemaMajor = ydoc.getMap("meta").get("v");
    if (schemaMajor !== 1) {
      throw new InvalidSnapshotError(
        typeof schemaMajor === "number"
          ? `loadDoc: unsupported schema version ${schemaMajor} (this reader stands v1; a v${schemaMajor} document requires the corresponding migrator)`
          : `loadDoc: missing or malformed schema version ${JSON.stringify(schemaMajor)} (expected the number 1)`
      );
    }
    // A full snapshot is the only loadable state: an incremental delta applied
    // to an empty doc yields a partial document, so validate it loudly.
    const json = toDocJSON(ydoc);
    const errors = validateDoc(json);
    if (errors.length > 0) {
      throw new InvalidSnapshotError(
        `loadDoc expects a full document snapshot; got an incomplete or invalid state: ${formatValidationErrors(errors)}`
      );
    }
    // Eager normalization of the legacy nesting form: the live document is
    // always flat, so a legacy snapshot is rewritten (depth -> indent) as a
    // fresh load step; a flat snapshot loads as-is (byte-identical state).
    const flat = flattenDoc(json);
    if (JSON.stringify(flat) !== JSON.stringify(json)) {
      const normalized = new Y.Doc();
      writeDocument(normalized, flat);
      return new Doc(normalized, randomId);
    }
    return new Doc(ydoc, randomId);
  }

  /** Factory for a document built from schema JSON (see fromJSON). */
  static fromJSON(json: DocJSON): Doc {
    // The z-order mirror (the canvas elements' dense `zIndex`) can be stale
    // in a saved snapshot after a concurrent merge; re-derive it from the
    // children order before validation (the single source of the z-order).
    const normalized = normalizeZOrder(json);
    const errors = validateDoc(normalized);
    if (errors.length > 0) throw errors;
    // The legacy nesting form is valid v1 input: normalize it to the flat
    // form on load, so the live document is always flat (and toJSON flat).
    const ydoc = new Y.Doc();
    writeDocument(ydoc, flattenDoc(normalized));
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

  /**
   * Changes a block's type. The content must survive (both types carry
   * it), the children must fit the target's children rules, the new type
   * must fit the block's parent, and the target's required attrs must be
   * satisfied: the current attrs the target also declares are carried
   * over, `attrs` overrides them, and type-specific attrs are dropped.
   */
  changeBlockType<T extends BlockType>(...args: ChangeBlockTypeArgs<T>): void {
    const [id, type, attrs] = args;
    changeBlockTypeCommand(this.#ydoc, this.#generateId, id, type, attrs);
  }

  /** Removes a block and its whole subtree. */
  removeBlock(id: BlockId): void {
    removeBlockCommand(this.#ydoc, id);
  }

  /** Replaces the document title. */
  setTitle(text: string): void {
    setTitleCommand(this.#ydoc, text);
  }

  /** Sets the document's avatar (a short string / a few emoji); `null` or the empty string clears it. */
  setAvatar(avatar: string | null): void {
    setAvatarCommand(this.#ydoc, avatar);
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
   * Moves a database block to the external form: the inline rows and the
   * schema leave the document (the consumer moves them into its relational
   * table first), and the block keeps the `tableId` reference plus its other
   * attrs. One transaction — one undo step, one wire update. Re-linking an
   * already-external block to another table changes only the reference.
   */
  setDatabaseTable(databaseId: BlockId, tableId: string): void {
    setDatabaseTableCommand(this.#ydoc, databaseId, tableId);
  }

  /**
   * Inserts an empty row into a table at `at` (0 = the first row, the row
   * count = the last; appended when omitted; the cells have no content
   * blocks until edited) and returns the row id.
   */
  insertTableRow(tableId: BlockId, at?: number): BlockId {
    return insertTableRowCommand(this.#ydoc, this.#generateId, tableId, at);
  }

  /** Removes a table row; the last row converts the table into a paragraph in place. */
  removeTableRow(tableId: BlockId, rowId: BlockId): void {
    removeTableRowCommand(this.#ydoc, tableId, rowId);
  }

  /** Moves a table row to `toIndex` (pre-move index semantics, like moveRow). */
  moveTableRow(tableId: BlockId, rowId: BlockId, toIndex: number): void {
    moveTableRowCommand(this.#ydoc, tableId, rowId, toIndex);
  }

  /** Duplicates a table row right below it (cells deep-copied) and returns the new row id. */
  duplicateTableRow(tableId: BlockId, rowId: BlockId): BlockId {
    return duplicateTableRowCommand(this.#ydoc, this.#generateId, tableId, rowId);
  }

  /** Clears the cell content of every cell in a row (the cells stay, empty). */
  clearTableRow(tableId: BlockId, rowId: BlockId): void {
    clearTableRowCommand(this.#ydoc, tableId, rowId);
  }

  /** Sets (or removes, `null`) the row background color on every cell of a row. */
  setTableRowColor(tableId: BlockId, rowId: BlockId, color: string | null): void {
    setTableRowColorCommand(this.#ydoc, tableId, rowId, color);
  }

  /**
   * Inserts an empty column (100 px wide) into a table at `at` (0 = the
   * first column, the column count = the last; appended when omitted);
   * `cols` and `columnWidths` stay in sync.
   */
  insertTableColumn(tableId: BlockId, at?: number): void {
    insertTableColumnCommand(this.#ydoc, this.#generateId, tableId, at);
  }

  /** Removes the table column at `index`; the last column converts the table into a paragraph in place. */
  removeTableColumn(tableId: BlockId, index: number): void {
    removeTableColumnCommand(this.#ydoc, tableId, index);
  }

  /** Moves a column (cells in every row + its width entry) from `fromIndex` to `toIndex` (pre-move). */
  moveTableColumn(tableId: BlockId, fromIndex: number, toIndex: number): void {
    moveTableColumnCommand(this.#ydoc, tableId, fromIndex, toIndex);
  }

  /** Duplicates the column at `index` right of it (cells deep-copied, width entry copied). */
  duplicateTableColumn(tableId: BlockId, index: number): void {
    duplicateTableColumnCommand(this.#ydoc, this.#generateId, tableId, index);
  }

  /** Clears the cell content of every cell in a column (the cells stay, empty). */
  clearTableColumn(tableId: BlockId, index: number): void {
    clearTableColumnCommand(this.#ydoc, tableId, index);
  }

  /** Sets (or removes, `null`) the column background color on every cell of a column. */
  setTableColumnColor(tableId: BlockId, index: number, color: string | null): void {
    setTableColumnColorCommand(this.#ydoc, tableId, index, color);
  }

  /** Sets the width of the column at `index` (>= 50; an equal-value set emits no update). */
  setTableColumnWidth(tableId: BlockId, index: number, width: number): void {
    setTableColumnWidthCommand(this.#ydoc, tableId, index, width);
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

  /**
   * Reorders a surface's canvas element (shape / connector / canvas-text /
   * group) by the z-order action and rewrites the dense `zIndex` (one
   * transaction — one undo step, one wire update). A step at the top / bottom
   * edge is a no-op.
   */
  setZOrder(id: BlockId, action: ZOrderAction): void {
    setZOrderCommand(this.#ydoc, id, action);
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

  /**
   * Deletes the cross-block text range [from, to) and returns the caret
   * seam (the point the caret lands on); null when the document carries
   * no text left. Same-block ranges delegate to deleteText.
   */
  deleteTextRange(from: TextPoint, to: TextPoint): TextPoint | null {
    return deleteTextRangeCommand(this.#ydoc, from, to);
  }

  /**
   * Applies a mark to the cross-block text range [from, to): the per-block
   * segments of the range's DFS chain, in one transaction. Same-block
   * ranges delegate to setMark.
   */
  setMarkRange(from: TextPoint, to: TextPoint, mark: MarkInput): void {
    setMarkRangeCommand(this.#ydoc, from, to, mark);
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
   * Subscribe to the non-local-origin changes (the wire's applies and the
   * escaped `raw` commits, one emission per transaction). Local
   * transactions — the commands, the undo manager — never emit here.
   * Returns an unsubscribe function (safe to call twice).
   */
  onRemoteChange(handler: (change: Change) => void): () => void {
    return onDocRemoteChange(this.#ydoc, handler);
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
 * ValidationError list as-is on violations. The legacy nesting form is
 * valid input and is normalized to the flat form on load. Runs are written
 * as given.
 */
function fromJSON(json: DocJSON): Doc {
  return Doc.fromJSON(json);
}

export { Doc, createDoc, fromJSON, loadDoc };
export type { CreateDocOptions };
