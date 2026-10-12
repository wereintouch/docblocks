import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import type { Block, BlockId, Change, Doc, DocMeta, PresenceState, Selection } from "docblocks-core";

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
  /** The entry-list block ids: the document root's children, or a single subtree root. */
  rootChildren: BlockId[];
  /** Document meta; replaced only when the title changed. */
  meta: DocMeta;
  /** Local view selection; a separate slice so caret moves never re-render blocks. */
  selection: Selection;
  /**
   * The collapsed list-item ids (the children are hidden). Local view
   * state, never document data: a separate slice, reset on remount.
   */
  collapsedIds: BlockId[];
  /** Remote peers' ephemeral state; a separate slice for the same reason. */
  presence: PresenceState[];
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
}

/** The per-instance vanilla store created by `createEditorStore`. */
type EditorStore = StoreApi<EditorState & EditorActions>;

/**
 * Structural equality over plain snapshot values (blocks and meta). The
 * seed and the diff share one reader (`toDocJSON` / `getBlock` both build
 * blocks via `readBlock`), so comparing those snapshots is meaningful.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  if (keysA.length !== Object.keys(objB).length) return false;
  return keysA.every((key) => key in objB && deepEqual(objA[key], objB[key]));
}

/**
 * Create the editor store for one Doc. The store is seeded with the doc's
 * current snapshot; afterwards it only advances through `applyChange` and
 * the presence/selection setters. One store per editor instance.
 *
 * `rootId` is the entry-list root: the document root by default (its
 * children are the entry list), or a subtree block — the entry list is the
 * block itself, whose own renderers carry its descendants.
 */
function createEditorStore(doc: Doc, rootId?: BlockId): EditorStore {
  const { blocks: initialBlocks, ...initialMeta } = doc.toJSON();
  const entryRootId = rootId ?? doc.meta.id;
  const isDocRoot = entryRootId === doc.meta.id;
  const initialRootChildren = isDocRoot ? doc.getChildren(entryRootId) : [entryRootId];

  const applyChange: EditorActions["applyChange"] = (change) => {
    const state = store.getState();
    const patch: Partial<EditorState> = {};

    if (change.blockIds.length > 0) {
      let blocks = state.blocks;
      let blocksChanged = false;
      const removed = new Set<BlockId>();
      for (const id of new Set(change.blockIds)) {
        const fresh = doc.getBlock(id);
        const prev = blocks[id];
        if (fresh === null) {
          // The block was removed: drop it from the map.
          if (prev !== undefined) {
            blocks = { ...blocks };
            delete blocks[id];
            blocksChanged = true;
            removed.add(id);
          }
        } else if (prev === undefined || !deepEqual(prev, fresh)) {
          // Added or changed: replace the reference; unchanged blocks keep theirs.
          blocks = { ...blocks, [id]: fresh };
          blocksChanged = true;
        }
      }
      if (blocksChanged) patch.blocks = blocks;

      // Only the document root's entry list is dynamic: a subtree entry is
      // the fixed [rootId] (descendants track through the block snapshots).
      if (isDocRoot && change.blockIds.includes(entryRootId)) {
        const children = doc.getChildren(entryRootId);
        if (!deepEqual(state.rootChildren, children)) patch.rootChildren = children;
      }

      // A removed block's collapse state is stale (harmless, but it must
      // not accumulate across a long session).
      if (removed.size > 0 && state.collapsedIds.some((id) => removed.has(id))) {
        patch.collapsedIds = state.collapsedIds.filter((id) => !removed.has(id));
      }
    }

    if (change.metaChanged) patch.meta = doc.meta;

    if (patch.blocks !== undefined || patch.rootChildren !== undefined || patch.meta !== undefined) {
      store.setState(patch);
    }
  };

  const store = createStore<EditorState & EditorActions>(() => ({
    blocks: initialBlocks,
    rootChildren: initialRootChildren,
    meta: initialMeta,
    selection: { kind: "none" },
    collapsedIds: [],
    presence: [],
    applyChange,
    setPresence: (peers) => store.setState({ presence: peers }),
    setSelection: (selection) => store.setState({ selection }),
    setCollapsed: (id, collapsed) => {
      const ids = store.getState().collapsedIds;
      store.setState({
        collapsedIds: collapsed ? [...(ids.includes(id) ? ids : [...ids, id])] : ids.filter((x) => x !== id),
      });
    },
  }));

  return store;
}

export { createEditorStore };
export type { EditorActions, EditorState, EditorStore };
