/** The provider's awareness receive: the remote frames resolve into the
 *  store's presence slice (the peer's latest frame wins, the async
 *  decrypt's race guarded by the frame's `seq` + the resolution's
 *  generation). */
import { useEffect, useRef } from "react";

import type { PresenceState, SyncProvider } from "docblocks-core";

import { resolvePeerSelection } from "../presence";
import type { EditorStore } from "../state";
import type { PresenceConfig } from "./models";

function usePresenceReceive(
  provider: SyncProvider | undefined,
  store: EditorStore,
  presence: PresenceConfig | undefined
): void {
  // The consumer's cipher is read at receive time (the effect stays keyed
  // on provider / store — a fresh inline presence prop must not re-subscribe).
  const presenceRef = useRef(presence);
  presenceRef.current = presence;

  useEffect(() => {
    if (provider === undefined) return;

    // Transports re-emit the (unchanged) remote peer list on every
    // awareness update — including the one triggered by this provider's
    // own setAwareness — so an unchanged list must not churn the slice
    // reference (reference stability across unrelated changes).
    let lastPeers = "";
    // The latest raw frame per peer: a frame older than the peer's latest
    // (the async decrypt's race — the older frame's decrypt can resolve
    // after a newer one's) never enters the set, so the slice always
    // resolves over the latest frames only.
    const latest = new Map<string, PresenceState>();
    // The resolution's generation: the last-started resolution owns the
    // slice (an earlier one finishing late stands dropped).
    let generation = 0;

    const unsubscribeAwareness = provider.onAwareness((rawPeers) => {
      const serialized = JSON.stringify(rawPeers);
      if (serialized === lastPeers) return;
      lastPeers = serialized;
      const rawIds = new Set(rawPeers.map((peer) => peer.peerId));
      for (const id of [...latest.keys()]) if (!rawIds.has(id)) latest.delete(id);
      for (const peer of rawPeers) {
        const prev = latest.get(peer.peerId);
        if (peer.seq !== undefined && prev?.seq !== undefined && peer.seq < prev.seq) continue;
        latest.set(peer.peerId, peer);
      }
      const gen = ++generation;
      const crypto = presenceRef.current?.crypto ?? null;
      const input = [...latest.values()];
      void (async () => {
        const resolved: PresenceState[] = [];
        for (const peer of input) {
          resolved.push(await resolvePeerSelection({ peer, crypto }));
        }
        if (gen !== generation) return;
        store.getState().setPresence(resolved);
      })();
    });
    return () => unsubscribeAwareness();
  }, [provider, store]);
}

export { usePresenceReceive };
