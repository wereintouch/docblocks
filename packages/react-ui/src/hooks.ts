import { useStore } from "zustand";

import { useMemo, useRef } from "react";

import type { Block, BlockId, Doc, DocMeta, PresenceState, Selection, SelectionView } from "docblocks-core";

import { useEditorContext } from "./editor-provider";
import type { PresencePeer, PresenceSharing, PresenceSharingMode } from "./presence";

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

/**
 * The presence sharing's session state (per provider instance): the local
 * grant (the default "off" — the privacy stand), the grant's setter (a
 * no-op over the read-only stand), and the live roster of the connected
 * peers (the identity frames are always present, the selection only over
 * the grant it stands shared).
 */
function usePresenceSharing(): PresenceSharing {
  const { store, viewMode, presence: presenceConfig } = useEditorContext();
  const sharing = useStore(store, (state) => state.sharing);
  const setSharing = useStore(store, (state) => state.setSharing);
  const presence = useStore(store, (state) => state.presence);

  const peers = useMemo<PresencePeer[]>(
    () =>
      presence.map((peer) => ({
        peerId: peer.peerId,
        userId: peer.userId,
        name: peer.name,
        updatedAt: peer.updatedAt,
        selectionVisible: peer.selection !== null,
      })),
    [presence]
  );

  const setSharingRef = useRef(setSharing);
  setSharingRef.current = setSharing;

  return useMemo<PresenceSharing>(
    () => ({
      sharing,
      // The read-only stand: the grant never stands over a non-edit mode;
      // the targeted stand requires the consumer's identity + cipher
      // (without them the setter stands a no-op — the degraded stand, the
      // grant keeps its stand).
      setSharing: (mode: PresenceSharingMode) => {
        if (viewMode) return;
        if (
          Array.isArray(mode) &&
          (presenceConfig === null || presenceConfig.userId === undefined || presenceConfig.crypto === undefined)
        ) {
          console.warn(
            "docblocks-react-ui: the targeted presence sharing requires the presence prop's userId and crypto — the grant stands off."
          );
          return;
        }
        setSharingRef.current(mode);
      },
      peers,
    }),
    [sharing, viewMode, peers, presenceConfig]
  );
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

export { useBlock, useDoc, useMeta, usePresence, usePresenceSharing, useSelection, useSelectionView, useText };
