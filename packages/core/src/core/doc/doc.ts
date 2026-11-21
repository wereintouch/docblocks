import type * as Y from "yjs";

import type {
  Block,
  BlockAttrsPatch,
  BlockId,
  BlockType,
  DatabaseCellValue,
  DocAttributeValue,
  DocJSON,
  DocMeta,
  Geometry,
  MarkName,
  MarkSet,
  TextRun,
} from "@docblocks-core/schema";

import type { ChangeBlockTypeArgs, InsertBlockArgs, MarkInput, ZOrderAction } from "../commands";
import type { Change } from "../events";
import { undoManagerOf } from "../history";
import type { TextPoint } from "../selection";
import * as blocks from "./delegates-blocks";
import * as database from "./delegates-database";
import * as docMeta from "./delegates-meta";
import * as table from "./delegates-table";
import * as textOps from "./delegates-text";
import { materializeCreate, materializeFromJSON, materializeLoad } from "./materialize";
import type { CreateDocOptions } from "./models";
import * as surfaces from "./surfaces";
import { transactDoc } from "./transact";

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
    const { ydoc, generateId } = materializeCreate(options);
    return new Doc(ydoc, generateId);
  }
  /** Factory for a document restored from a CRDT snapshot (see loadDoc). */
  static load(bytes: Uint8Array): Doc {
    const { ydoc, generateId } = materializeLoad(bytes);
    return new Doc(ydoc, generateId);
  }
  /** Factory for a document built from schema JSON (see fromJSON). */
  static fromJSON(json: DocJSON): Doc {
    const { ydoc, generateId } = materializeFromJSON(json);
    return new Doc(ydoc, generateId);
  }
  /** Escape hatch: the underlying Y.Doc. Not guaranteed to stay. */
  get raw(): Y.Doc {
    return this.#ydoc;
  }
  get meta(): DocMeta {
    return surfaces.meta(this.#ydoc);
  }
  get lastUpdatedAt(): string | null {
    return surfaces.lastUpdatedAt(this.#ydoc);
  }
  getBlock(id: BlockId): Block | null {
    return surfaces.getBlock(this.#ydoc, id);
  }
  getChildren(id: BlockId): BlockId[] {
    return surfaces.getChildren(this.#ydoc, id);
  }
  getRuns(blockId: BlockId): TextRun[] {
    return surfaces.getRuns(this.#ydoc, blockId);
  }
  getText(blockId: BlockId): string {
    return surfaces.getText(this.#ydoc, blockId);
  }
  getTextLength(blockId: BlockId): number {
    return surfaces.getTextLength(this.#ydoc, blockId);
  }
  // ---- semantic commands: the only path for normal editing ----
  /** Inserts one block; the type's attrs are required exactly when the registry declares them. */
  insertBlock<T extends BlockType>(...args: InsertBlockArgs<T>): BlockId {
    return blocks.insertBlock<T>(this.#ydoc, this.#generateId, ...args);
  }
  updateBlock(id: BlockId, patch: BlockAttrsPatch): void {
    blocks.updateBlock(this.#ydoc, id, patch);
  }
  removeBlockAttr(id: BlockId, key: string): void {
    blocks.removeBlockAttr(this.#ydoc, id, key);
  }
  /** Moves the block (and its derived segment) to the new position in the sequence. */
  moveBlock(id: BlockId, toParent: BlockId, toIndex: number): void {
    blocks.moveBlock(this.#ydoc, id, toParent, toIndex);
  }
  changeBlockType<T extends BlockType>(...args: ChangeBlockTypeArgs<T>): void {
    blocks.changeBlockType<T>(this.#ydoc, this.#generateId, ...args);
  }
  /** Removes the block and its derived segment. */
  removeBlock(id: BlockId): void {
    blocks.removeBlock(this.#ydoc, id);
  }
  setTitle(text: string): void {
    docMeta.setTitle(this.#ydoc, text);
  }
  setAvatar(avatar: string | null): void {
    docMeta.setAvatar(this.#ydoc, avatar);
  }
  setAttribute(key: string, value: DocAttributeValue): void {
    docMeta.setAttribute(this.#ydoc, key, value);
  }
  removeAttribute(key: string): void {
    docMeta.removeAttribute(this.#ydoc, key);
  }
  renameAttribute(fromKey: string, toKey: string): void {
    docMeta.renameAttribute(this.#ydoc, fromKey, toKey);
  }
  reorderAttributes(order: string[]): void {
    docMeta.reorderAttributes(this.#ydoc, order);
  }
  insertRow(databaseId: BlockId): BlockId {
    return database.insertRow(this.#ydoc, this.#generateId, databaseId);
  }
  setCell(databaseId: BlockId, rowId: string, colId: string, value: DatabaseCellValue | undefined): void {
    database.setCell(this.#ydoc, databaseId, rowId, colId, value);
  }
  removeRow(databaseId: BlockId, rowId: string): void {
    database.removeRow(this.#ydoc, databaseId, rowId);
  }
  moveRow(databaseId: BlockId, rowId: string, toIndex: number): void {
    database.moveRow(this.#ydoc, databaseId, rowId, toIndex);
  }
  setDatabaseTable(databaseId: BlockId, tableId: string): void {
    database.setDatabaseTable(this.#ydoc, databaseId, tableId);
  }
  insertTableRow(tableId: BlockId, at?: number): BlockId {
    return table.insertTableRow(this.#ydoc, this.#generateId, tableId, at);
  }
  removeTableRow(tableId: BlockId, rowId: BlockId): void {
    table.removeTableRow(this.#ydoc, tableId, rowId);
  }
  moveTableRow(tableId: BlockId, rowId: BlockId, toIndex: number): void {
    table.moveTableRow(this.#ydoc, tableId, rowId, toIndex);
  }
  duplicateTableRow(tableId: BlockId, rowId: BlockId): BlockId {
    return table.duplicateTableRow(this.#ydoc, this.#generateId, tableId, rowId);
  }
  clearTableRow(tableId: BlockId, rowId: BlockId): void {
    table.clearTableRow(this.#ydoc, tableId, rowId);
  }
  setTableRowColor(tableId: BlockId, rowId: BlockId, color: string | null): void {
    table.setTableRowColor(this.#ydoc, tableId, rowId, color);
  }
  insertTableColumn(tableId: BlockId, at?: number): void {
    table.insertTableColumn(this.#ydoc, this.#generateId, tableId, at);
  }
  removeTableColumn(tableId: BlockId, index: number): void {
    table.removeTableColumn(this.#ydoc, tableId, index);
  }
  moveTableColumn(tableId: BlockId, fromIndex: number, toIndex: number): void {
    table.moveTableColumn(this.#ydoc, tableId, fromIndex, toIndex);
  }
  duplicateTableColumn(tableId: BlockId, index: number): void {
    table.duplicateTableColumn(this.#ydoc, this.#generateId, tableId, index);
  }
  clearTableColumn(tableId: BlockId, index: number): void {
    table.clearTableColumn(this.#ydoc, tableId, index);
  }
  setTableColumnColor(tableId: BlockId, index: number, color: string | null): void {
    table.setTableColumnColor(this.#ydoc, tableId, index, color);
  }
  setTableColumnWidth(tableId: BlockId, index: number, width: number): void {
    table.setTableColumnWidth(this.#ydoc, tableId, index, width);
  }
  setGeometry(id: BlockId, geometry: Partial<Geometry> | null): void {
    blocks.setGeometry(this.#ydoc, id, geometry);
  }
  setZOrder(id: BlockId, action: ZOrderAction): void {
    blocks.setZOrder(this.#ydoc, id, action);
  }
  /** Inserts text at the position, with the optional marks. */
  insertText(blockId: BlockId, pos: number, text: string, marks?: MarkSet): void {
    textOps.insertText(this.#ydoc, blockId, pos, text, marks);
  }
  /** Deletes the text range from the block. */
  deleteText(blockId: BlockId, from: number, to: number): void {
    textOps.deleteText(this.#ydoc, blockId, from, to);
  }
  setMark(blockId: BlockId, from: number, to: number, mark: MarkInput): void {
    textOps.setMark(this.#ydoc, blockId, from, to, mark);
  }
  unsetMark(blockId: BlockId, from: number, to: number, name: MarkName): void {
    textOps.unsetMark(this.#ydoc, blockId, from, to, name);
  }
  deleteTextRange(from: TextPoint, to: TextPoint): TextPoint | null {
    return textOps.deleteTextRange(this.#ydoc, from, to);
  }
  setMarkRange(from: TextPoint, to: TextPoint, mark: MarkInput): void {
    textOps.setMarkRange(this.#ydoc, from, to, mark);
  }
  /** The document's JSON snapshot (plain objects per the schema). */
  toJSON(): DocJSON {
    return surfaces.toJSON(this.#ydoc);
  }
  /** The full CRDT state (the sync's bootstrap payload). */
  encode(): Uint8Array {
    return surfaces.encode(this.#ydoc);
  }
  /** The state's delta over the given state vector (the incremental wire update). */
  encodeUpdate(stateVector?: Uint8Array): Uint8Array {
    return surfaces.encodeUpdate(this.#ydoc, stateVector);
  }
  /** Applies a received CRDT update (a peer's state or delta). */
  applyUpdate(bytes: Uint8Array): void {
    surfaces.applyUpdate(this.#ydoc, bytes);
  }
  // ---- transactions, undo/redo, reactivity ----
  /**
   * Run `fn` as one local transaction: one Yjs update and one undo step,
   * however many commands `fn` runs (commands join this transaction).
   * If `fn` throws, the batch's changes are rolled back and the error
   * propagates. A failed batch still emits a transient `onChange` emission
   * and a partial wire update before the rollback (CRDT property: the
   * rollback is best-effort on the wire; observable state converges).
   * A subscription handler's throw (the handlers fire inside the
   * transaction) is isolated — it stands the logged error and never rolls
   * back a committed batch.
   */
  transact(fn: () => void): void {
    transactDoc(this.#ydoc, fn);
  }
  undo(): void {
    surfaces.undo(this.#ydoc);
  }
  redo(): void {
    surfaces.redo(this.#ydoc);
  }
  get canUndo(): boolean {
    return surfaces.canUndo(this.#ydoc);
  }
  get canRedo(): boolean {
    return surfaces.canRedo(this.#ydoc);
  }
  onChange(handler: (change: Change) => void): () => void {
    return surfaces.onChange(this.#ydoc, handler);
  }
  onRemoteChange(handler: (change: Change) => void): () => void {
    return surfaces.onRemoteChange(this.#ydoc, handler);
  }
  onBlock(id: BlockId, handler: (block: Block) => void): () => void {
    return surfaces.onBlock(this.#ydoc, id, handler);
  }
  observeText(blockId: BlockId, handler: (text: string) => void): () => void {
    return surfaces.observeText(this.#ydoc, blockId, handler);
  }
}

export { Doc };
