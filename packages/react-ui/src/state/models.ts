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
 * clear). The per-instance vanilla store created by `createEditorStore`. */
import type { StoreApi } from "zustand/vanilla";

import type { Block, BlockId, Change, DocMeta, PresenceState, Selection } from "docblocks-core";

import type { CanvasClipboard } from "../canvas";

/**
 * Per-instance editor state: a projection of one docblocks-core Doc.
 *
 * The store is never the source of truth — writes go command -> Doc ->
 * onChange -> applyChange. Slice references are stable across changes a
 * slice is not involved in, so a component selecting one block re-renders
 * only when that block actually changed.
 */
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
   * `indent` / `list` kind changing) — never on a text/mark change of an
   * unchanged structure. The motion view's row derivation keys on it, so a
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
   * The canvas clipboard: the deep copy of
   * the copied canvas items — the view state per editor (not doc data, no
   * wire); `null` when empty. A separate slice so the copy never re-renders
   * blocks.
   */
  canvasClipboard: CanvasClipboard | null;
}

/** Internal write functions, called by the EditorProvider subscriptions. */
interface EditorActions {
  /** Re-reads the blocks a doc change touched, keeping stable references for the unchanged ones. */
  applyChange: (change: Change) => void;
  /** Replaces the presence slice. */
  setPresence: (peers: PresenceState[]) => void;
  /** Replaces the selection slice. */
  setSelection: (selection: Selection) => void;
  /** Sets the collapsed state of one list item (view state, no doc command). */
  setCollapsed: (id: BlockId, collapsed: boolean) => void;
  /** Replaces the canvas clipboard slice (the copy / the clear). */
  setCanvasClipboard: (clipboard: CanvasClipboard | null) => void;
}

/** The per-instance vanilla store created by `createEditorStore`. */
type EditorStore = StoreApi<EditorState & EditorActions>;

export type { EditorActions, EditorState, EditorStore };
