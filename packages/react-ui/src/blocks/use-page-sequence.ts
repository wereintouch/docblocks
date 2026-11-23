/**
 * The page view's row sequence over the store: the root's page children
 * (the canvas surfaces filtered out — they are canvas layers, not page
 * blocks), the flat derivation with its interning cache (a text-only edit
 * leaves the derivation standing), the visible rows over the collapsed
 * set, and the read-only empty-text chain's collapse. Every step keys on
 * the store's sequence stamp, so a text-only edit re-renders the edited row
 * alone.
 */
import { useStore } from "zustand";

import { useMemo, useRef } from "react";

import type { BlockId } from "docblocks-core";

import type { EditorStore } from "../state/models";
import { collapseEmptyTextChains, deriveFlat, isEmptyChainText, visibleRows } from "./flat";
import type { FlatNode } from "./flat";

interface PageSequenceInput {
  store: EditorStore;
  rootChildren: readonly BlockId[];
  /** The read-only stand (the view / published modes): the consecutive
   *  empty text blocks render as one (the data stays untouched). */
  viewMode: boolean;
}

interface PageSequence {
  /** The page's blocks in reading order (the canvas surfaces are out). */
  pageChildren: BlockId[];
  /** The flat sequence's nodes (the row list's by-id stand). */
  nodesById: Map<string, FlatNode>;
  /** The rendered rows (the collapsed segments unmounted; the local drag
   *  order and the commit run over the visible rows). */
  collapsedRowKeys: BlockId[];
}

function usePageSequence({ store, rootChildren, viewMode }: PageSequenceInput): PageSequence {
  const seqStamp = useStore(store, (state) => state.seqStamp);
  const collapsedIds = useStore(store, (state) => state.collapsedIds);
  // The filter keys on the structure inputs and reads the blocks map from
  // the store's live state (a text-only edit advances nothing here).
  const pageChildren = useMemo(
    () => rootChildren.filter((id) => store.getState().blocks[id]?.type !== "surface"),
    [rootChildren, seqStamp, store]
  );
  // The interning cache: the previous derivation's byId stands while the
  // sequence's data is unchanged (the row memo keys on the node identity).
  // The blocks map is read from the store's live state (the stamp and the
  // map advance in the same atomic write — the map stands fresh whenever
  // the stamp does).
  const prevRef = useRef<Map<string, FlatNode> | null>(null);
  const derivation = useMemo(() => {
    const result = deriveFlat(pageChildren, store.getState().blocks, prevRef.current ?? undefined);
    prevRef.current = result.byId;
    return result;
  }, [pageChildren, seqStamp, store]);
  const nodesById = derivation.byId;
  const rowKeys = useMemo(
    () => visibleRows(pageChildren, nodesById, collapsedIds),
    [pageChildren, nodesById, collapsedIds]
  );
  // The digest stands the remote's empty block's flip (the read-only view
  // reads the live doc); the edit's mode stands no digest.
  const emptyKey = useStore(store, (state) =>
    viewMode
      ? pageChildren
          .map((id) => {
            const block = state.blocks[id];
            return isEmptyChainText(block) ? "o" : block === undefined ? "-" : ".";
          })
          .join("")
      : ""
  );
  const collapsedRowKeys = useMemo(() => {
    if (!viewMode) return rowKeys;
    const nodes: FlatNode[] = [];
    for (const id of rowKeys) {
      const node = nodesById.get(id);
      if (node !== undefined) nodes.push(node);
    }
    return collapseEmptyTextChains(nodes, (id) => isEmptyChainText(store.getState().blocks[id])).map((node) => node.id);
  }, [rowKeys, viewMode, emptyKey, nodesById, store]);

  return { pageChildren, nodesById, collapsedRowKeys };
}

export { usePageSequence };
export type { PageSequence, PageSequenceInput };
