import { createStore } from "zustand/vanilla";

import type { BlockId, Doc } from "docblocks-core";

import { sequenceContainerOf, subtreeSegmentOf } from "../blocks";
import type { EditorActions, EditorState, EditorStore } from "./models";
import { deepEqual, knownBlocks } from "./utils";

function createEditorStore(doc: Doc, rootId?: BlockId): EditorStore {
  const { blocks: allBlocks, ...initialMeta } = doc.toJSON();
  const initialBlocks = knownBlocks(allBlocks);
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

    // A touched block IN the entry sequence whose `indent` or `list` kind
    // moved (the seqStamp's source — the derivation's structure inputs; a
    // text/mark change stands nothing, the row's own subscription
    // re-renders it). An add/removal into or out of the sequence stands the
    // rootChildren change (the stamp's other source).
    let seqStructureAffected = false;

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
        if (prev !== undefined && fresh !== null && state.rootChildren.includes(id)) {
          const prevAttrs = ("attrs" in prev ? prev.attrs : undefined) as
            { indent?: unknown; list?: unknown } | undefined;
          const freshAttrs = ("attrs" in fresh ? fresh.attrs : undefined) as
            { indent?: unknown; list?: unknown } | undefined;
          if (prevAttrs?.indent !== freshAttrs?.indent || prevAttrs?.list !== freshAttrs?.list) {
            seqStructureAffected = true;
          }
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

    // The sequence-structure stamp (the motion view's derivation key): a
    // rootChildren change or a sequence block's indent / list kind moved.
    if (patch.rootChildren !== undefined || seqStructureAffected) {
      patch.seqStamp = state.seqStamp + 1;
    }

    if (patch.blocks !== undefined || patch.rootChildren !== undefined || patch.meta !== undefined) {
      store.setState(patch);
    }
  };

  const store = createStore<EditorState & EditorActions>(() => ({
    blocks: initialBlocks,
    rootChildren: initialRootChildren,
    meta: initialMeta,
    seqStamp: 0,
    selection: { kind: "none" },
    collapsedIds: [],
    presence: [],
    canvasClipboard: null,
    applyChange,
    setPresence: (peers) => store.setState({ presence: peers }),
    setSelection: (selection) => store.setState({ selection }),
    setCollapsed: (id, collapsed) => {
      const ids = store.getState().collapsedIds;
      store.setState({
        collapsedIds: collapsed ? [...(ids.includes(id) ? ids : [...ids, id])] : ids.filter((x) => x !== id),
      });
    },
    setCanvasClipboard: (clipboard) => store.setState({ canvasClipboard: clipboard }),
  }));

  return store;
}

export { createEditorStore };
export type { EditorActions, EditorState, EditorStore };
