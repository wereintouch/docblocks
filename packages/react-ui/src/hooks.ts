import { useStore } from "zustand";

import type { Block, BlockId, Doc, DocMeta, PresenceState, Selection, SelectionView } from "docblocks-core";

import { useEditorContext } from "./EditorProvider";

/** The headless document owned by the nearest EditorProvider. */
function useDoc(): Doc {
  return useEditorContext().doc;
}

/**
 * The block snapshot at id; undefined when the block is missing (e.g.
 * removed by a peer). Selecting the reference itself keeps consumers
 * re-rendering only when the block actually changed.
 */
function useBlock(id: BlockId): Block | undefined {
  const { store } = useEditorContext();
  return useStore(store, (state) => state.blocks[id]);
}

/**
 * The flattened text of the block's runs. Read from the store (not via
 * `doc.getText`) so the read participates in the store's reference
 * stability: the selector re-runs on store changes, but consumers
 * re-render only when the flattened text actually changes.
 */
function useText(id: BlockId): string {
  const { store } = useEditorContext();
  return useStore(store, (state) => {
    const block = state.blocks[id];
    if (block === undefined) return "";
    const content = "content" in block ? block.content : undefined;
    if (content === undefined) return "";
    return content.reduce((text, run) => text + run.text, "");
  });
}

/** The local view selection; a separate slice so caret moves do not re-render block consumers. */
function useSelection(): Selection {
  const { store } = useEditorContext();
  return useStore(store, (state) => state.selection);
}

/** Remote peers' ephemeral state; a separate slice for the same reason. */
function usePresence(): PresenceState[] {
  const { store } = useEditorContext();
  return useStore(store, (state) => state.presence);
}

/** The document meta; the reference is replaced only when the title changed. */
function useMeta(): DocMeta {
  const { store } = useEditorContext();
  return useStore(store, (state) => state.meta);
}

/**
 * The per-instance selection view for setting selections and reading the
 * local state; null before the mount effect ran and after unmount (the
 * view is destroyed on unmount). Read it at event time (the render value
 * only updates when the component re-renders), not in effects keyed on
 * unrelated state.
 */
function useSelectionView(): SelectionView | null {
  return useEditorContext().selection.view;
}

export { useBlock, useDoc, useMeta, usePresence, useSelection, useSelectionView, useText };
