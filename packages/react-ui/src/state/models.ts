/** The per-instance editor state (a projection of one docblocks-core Doc):
 * the block snapshots keyed by id (a block keeps its reference while its
 * JSON is unchanged), the entry-list block ids (the document root's
 * children, or the subtree entry's derived segment), the document meta
 * (replaced only when the title changed), the sequence-structure stamp
 * (bumped only when the entry sequence's structure changes — never on a
 * text/mark change of an unchanged structure; the motion view's row
 * derivation keys on it), the local view selection (a separate slice so
 * caret moves never re-render blocks), the collapsed block ids (the
 * derived segment's rows are hidden — local view state, never document
 * data, no wire traffic), the remote peers' ephemeral state, the canvas
 * clipboard (the deep copy of the copied canvas items — the view state per
 * editor, not doc data, no wire; `null` when empty). The internal write
 * functions (called by the EditorProvider subscriptions): applyChange
 * (re-reads the blocks a doc change touched, keeping stable references
 * for the unchanged ones), setPresence (replaces the presence slice),
 * setSelection (replaces the selection slice), setCollapsed (sets the
 * collapsed state of one list item — view state, no doc command),
 * setCanvasClipboard (replaces the canvas clipboard slice — the copy / the
 * clear), setFileUpload (replaces the pending file upload stand — the set /
 * the clear), the changeStamp (bumped on every store write of `applyChange`
 * — the live `lastUpdatedAt` display's re-render source). The per-instance
 * vanilla store created by `createEditorStore`. */
import type { StoreApi } from "zustand/vanilla";

import type { Block, BlockId, Change, DocMeta, PresenceState, Selection } from "docblocks-core";

import type { CanvasClipboard } from "../canvas";
import type { PresenceSharingMode } from "../presence";

/**
 * The slash File command's upload stand: the block the skeleton stands on
 * + the phase. View state per editor (not doc data, no wire).
 */
interface FileUploadStand {
  /** The block the skeleton stand stands on (the trigger phrase's block). */
  blockId: BlockId;
  /**
   * The stand's phase: `picker` — the OS dialog's open (the file's not
   * delivered yet), `uploading` — the in-flight upload, `failed` — the
   * refused stand's error line (the stand's click dismisses it).
   */
  phase: "picker" | "uploading" | "failed";
}

/**
 * Per-instance editor state: a projection of one docblocks-core Doc.
 *
 * The store is never the source of truth — writes go command -> Doc ->
 * onChange -> applyChange. Slice references are stable across changes a
 * slice is not involved in, so a component selecting one block re-renders
 * only when that block actually changed.
 */
/** A rectangular cell range over one table (the grid coordinates, inclusive). */
interface TableCellRange {
  tableId: BlockId;
  /** The rectangle's top grid row (inclusive). */
  top: number;
  /** The rectangle's left grid column (inclusive). */
  left: number;
  /** The rectangle's bottom grid row (inclusive). */
  bottom: number;
  /** The rectangle's right grid column (inclusive). */
  right: number;
  /** The anchor cells standing in the rectangle (a covered cell stands no cell). */
  cellIds: readonly BlockId[];
  /**
   * The anchors' own grid rectangles (a merged anchor stands its region) —
   * the per-cell frame edges read from it, so a cell needs no grid math.
   */
  cells: Readonly<Record<BlockId, TableCellRangeRect>>;
}

/** One anchor's grid rectangle inside the range (the frame edges' source). */
interface TableCellRangeRect {
  row: number;
  col: number;
  colspan: number;
  rowspan: number;
}

interface EditorState {
  /** Block snapshots keyed by id; a block keeps its reference while its JSON is unchanged. */
  blocks: Record<BlockId, Block>;
  /**
   * The entry-list block ids: the document root's children (the page
   * sequence), or the subtree entry's derived segment (the subtree root
   * and its deeper followers — re-derived only when the change can affect
   * it, see `applyChange`'s invalidation: a peer or a local insert into
   * the segment grows it without touching the subtree root itself).
   */
  rootChildren: BlockId[];
  /** Document meta; replaced only when the title changed. */
  meta: DocMeta;
  /**
   * The sequence-structure stamp: bumped only when the entry sequence's
   * structure changes (a rootChildren change, or a sequence block's
   * `type` / `indent` / `list` kind changing) — never on a text/mark
   * change of an unchanged structure. The motion view's row derivation keys on it, so a
   * text-only edit re-renders the edited row through its own subscription
   * only (the origin is irrelevant — every change flows through
   * `applyChange`).
   */
  seqStamp: number;
  /** Local view selection; a separate slice so caret moves never re-render blocks. */
  selection: Selection;
  /**
   * The collapsed block ids (the derived segment's rows are hidden). Local
   * view state — never document data, no wire traffic; a separate slice,
   * reset on remount.
   */
  collapsedIds: BlockId[];
  /** Remote peers' ephemeral state; a separate slice for the same reason. */
  presence: PresenceState[];
  /**
   * The local selection's sharing grant (session state per provider
   * instance; the default "off" — not document data, never on the wire).
   * A separate slice so a grant change never re-renders blocks.
   */
  sharing: PresenceSharingMode;
  /**
   * The table cell range: the rectangular selection of cells over one table
   * (the merge / split gesture's stand). View state — never document data,
   * no wire traffic; a separate slice so a range move re-renders only its
   * cells.
   */
  tableRange: TableCellRange | null;
  /**
   * The canvas clipboard: the deep copy of
   * the copied canvas items — the view state per editor (not doc data, no
   * wire); `null` when empty. A separate slice so the copy never re-renders
   * blocks.
   */
  canvasClipboard: CanvasClipboard | null;
  /**
   * The slash File command's pending file upload stand (the phrase block's
   * row stands the skeleton over its content while the popover stands
   * closed). `null` when idle. A separate slice so a stand change never
   * re-renders the other blocks.
   */
  fileUpload: FileUploadStand | null;
  /**
   * The per-change stamp: bumped whenever `applyChange` writes the store
   * (a `blocks` / `rootChildren` / `meta` change). The live `lastUpdatedAt`
   * display's re-render source — the Yjs-only `meta.updatedAt` moves on
   * every local transaction and is not part of the `meta` slice (the
   * slice is replaced only over the `metaChanged`). A separate slice so
   * only the stamp's subscribers re-render over the changes.
   */
  changeStamp: number;
  /**
   * The canvas-chrome stamp: bumped only when a block's CHROME fields
   * (the `type`, the `geometry`, the `attrs`, the `children` — the
   * figures' boxes, the port dots' data, the connectors' line attrs, the
   * surface's structure) change or a block is added / removed — never
   * on a content-only change of an unchanged shape (a keystroke in a
   * figure's text). The canvas chrome's components key their memos on
   * the stamp (an O(1) read — the per-surface JSON digest stood the
   * O(siblings) stand per line per store notification). A separate slice
   * so only the chrome's subscribers re-render over the changes.
   */
  chromeStamp: number;
}

/** Internal write functions, called by the EditorProvider subscriptions. */
interface EditorActions {
  /** Re-reads the blocks a doc change touched, keeping stable references for the unchanged ones. */
  applyChange: (change: Change) => void;
  /** Replaces the presence slice. */
  setPresence: (peers: PresenceState[]) => void;
  /** Sets the local sharing grant. */
  setSharing: (mode: PresenceSharingMode) => void;
  /** Replaces the selection slice. */
  setSelection: (selection: Selection) => void;
  /** Sets the collapsed state of one list item (view state, no doc command). */
  setCollapsed: (id: BlockId, collapsed: boolean) => void;
  /** Replaces the table cell range (the gesture's move / the clear). */
  setTableCellRange: (range: TableCellRange | null) => void;
  /** Replaces the canvas clipboard slice (the copy / the clear). */
  setCanvasClipboard: (clipboard: CanvasClipboard | null) => void;
  /** Replaces the pending file upload stand (the set / the clear). */
  setFileUpload: (stand: FileUploadStand | null) => void;
}

/** The per-instance vanilla store created by `createEditorStore`. */
type EditorStore = StoreApi<EditorState & EditorActions>;

export type { EditorActions, EditorState, EditorStore, FileUploadStand, TableCellRange, TableCellRangeRect };
