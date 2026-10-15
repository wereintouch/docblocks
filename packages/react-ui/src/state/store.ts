import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import type { Block, BlockId, Change, Doc, DocMeta, PresenceState, Selection } from "docblocks-core";

import { sequenceContainerOf, subtreeSegmentOf } from "../blocks/flat";

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
 * block's derived segment (its deeper followers in the page sequence).
 */
function createEditorStore(doc: Doc, rootId?: BlockId): EditorStore {
  const { blocks: initialBlocks, ...initialMeta } = doc.toJSON();
  const entryRootId = rootId ?? doc.meta.id;
  const isDocRoot = entryRootId === doc.meta.id;
  // The subtree entry's sequence container, resolved from the store's own
  // blocks map (no doc snapshot): it stands until a change can affect the
  // resolution (see `applyChange`'s invalidation).
  let container = isDocRoot ? entryRootId : sequenceContainerOf(initialBlocks, entryRootId);
  const initialRootChildren = isDocRoot
    ? doc.getChildren(entryRootId)
    : subtreeSegmentOf(initialBlocks, container, entryRootId);

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

      // The entry list's dynamics: the document root's children change
      // with the root entry itself. The subtree entry's derived segment
      // re-derives only when the change can AFFECT it — a concurrent
      // (peer or local) insertion of a deeper block into the segment, or
      // a shallower block moving into the segment's end, does not touch
      // the subtree root, so the root-entry watch would miss it. The
      // derivation runs over the store's own blocks map (no doc snapshot
      // per change — the block snapshots' stability stands on the per-id
      // diff above, the seed and the diff share the same reader).
      if (isDocRoot) {
        if (change.blockIds.includes(entryRootId)) {
          const children = doc.getChildren(entryRootId);
          if (!deepEqual(state.rootChildren, children)) patch.rootChildren = children;
        }
      } else {
        // Invalidation rule: the segment (the container's sequence range
        // from the entry root to the first block with `indent` <= its own)
        // can change only when the change touches — the entry root itself
        // (its indent moves the end boundary, its type flips the
        // sequence-container check, its removal dangles it), the sequence
        // container (its children array is the sequence: an insert/move/
        // removal in it, a re-parent of the entry root), a block currently
        // inside the segment (its indent can move the end boundary; its
        // removal shrinks the segment), or the terminator after the
        // segment (the first sequence block with `indent` <= the entry
        // root's own — its indent can rise into the segment and grow it).
        // A text/mark change of an unaffected block keeps the segment
        // standing: no derivation, no doc read.
        const touched = new Set(change.blockIds);
        const current = state.rootChildren;
        // The terminator from the PRE-change state: the sequence block
        // right after the current segment (by the segment's definition it
        // stands at `indent` <= the entry root's own; absent when the
        // segment reaches the sequence's end). A stale segment (the entry
        // root out of the sequence — unreachable through applyChange, the
        // resync is free) re-derives outright.
        const oldContainer = state.blocks[container];
        const oldSequence =
          oldContainer !== undefined && "children" in oldContainer ? oldContainer.children : undefined;
        const segmentStart = oldSequence !== undefined ? oldSequence.indexOf(current[0]!) : -1;
        const staleSegment =
          oldSequence === undefined ||
          current.length === 0 ||
          segmentStart === -1 ||
          oldSequence.indexOf(current[current.length - 1]!) !== segmentStart + current.length - 1;
        const terminator =
          !staleSegment && oldSequence !== undefined ? (oldSequence[segmentStart + current.length] ?? null) : null;
        const affected =
          staleSegment ||
          touched.has(entryRootId) ||
          touched.has(container) ||
          current.some((id) => touched.has(id)) ||
          (terminator !== null && touched.has(terminator));
        if (affected) {
          // The resolution (entry root -> sequence container) re-scans
          // (over the store's own blocks map — no doc snapshot) only when
          // it can change: the entry root changed (its type flips the
          // sequence-container check), the resolved container changed (its
          // children may have lost the entry root), or a changed block now
          // holds the entry root in its children (a new parent). Otherwise
          // the cached container stands.
          let nextContainer = container;
          let resolutionMayMove = touched.has(entryRootId) || touched.has(container);
          if (!resolutionMayMove) {
            for (const id of change.blockIds) {
              const block = blocks[id];
              if (
                block !== undefined &&
                "children" in block &&
                block.children !== undefined &&
                block.children.includes(entryRootId)
              ) {
                resolutionMayMove = true;
                break;
              }
            }
          }
          if (resolutionMayMove) nextContainer = sequenceContainerOf(blocks, entryRootId);
          const segment = subtreeSegmentOf(blocks, nextContainer, entryRootId);
          if (!deepEqual(state.rootChildren, segment)) patch.rootChildren = segment;
          if (nextContainer !== container) container = nextContainer;
        }
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
