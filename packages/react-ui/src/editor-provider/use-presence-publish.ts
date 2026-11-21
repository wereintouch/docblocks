/** The provider's awareness publish: the local selection state travels
 *  into the provider's awareness over the sharing contract — the grant is
 *  session state (the store's sharing slice, the default "off"): "off" /
 *  the read-only stand publishes the identity only, "everyone" publishes
 *  the plaintext selection (the legacy stand), and a targeted grant
 *  encrypts per target over the consumer's cipher (no cipher — the
 *  publish stands dropped). Debounced on change, identity-only
 *  immediately on window blur or page unload, and an immediate re-publish
 *  on window focus (closing the stale-null gap after a blur). A transport
 *  that re-sends the local awareness state on (re)connect
 *  (WsSyncProvider does) restores the payload automatically after a
 *  reconnect. */
import { useEffect, useRef } from "react";

import { presenceSelectionOf } from "docblocks-core";
import type { Selection, SyncProvider } from "docblocks-core";

import { buildPresencePayload } from "../presence";
import type { EditorStore } from "../state";
import { AWARENESS_DEBOUNCE_MS } from "./constants";
import type { PresenceConfig } from "./models";

function usePresencePublish(
  provider: SyncProvider | undefined,
  store: EditorStore,
  presence: PresenceConfig | undefined,
  viewMode: boolean
): void {
  // The presence identity + cipher and the read-only stand are read at
  // publish time (the effect stays keyed on provider / store — a fresh
  // inline presence prop must not re-subscribe).
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  useEffect(() => {
    if (provider === undefined) return;

    // The monotonic publication counter (every publish increments it — the
    // recipient's seq guard orders the async decrypts).
    let seq = 0;
    // The async publish's token: a grant that changed in flight (the
    // cipher's await) must not land over the newer state.
    let publishToken = 0;

    const publish = (selection: Selection): void => {
      const token = ++publishToken;
      const sharing = store.getState().sharing;
      void (async () => {
        const payload = await buildPresencePayload({
          selection: presenceSelectionOf(selection),
          sharing,
          viewMode: viewModeRef.current,
          identity: presenceRef.current ?? {},
          crypto: presenceRef.current?.crypto ?? null,
          seq: ++seq,
          updatedAt: Date.now(),
        });
        if (token !== publishToken || payload === null) return;
        provider.setAwareness(payload);
      })();
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = (selection: Selection): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        publish(selection);
      }, AWARENESS_DEBOUNCE_MS);
    };
    const publishNow = (selection: Selection): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      publish(selection);
    };

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.selection !== prev.selection) queue(state.selection);
      if (state.sharing !== prev.sharing) publish(store.getState().selection);
    });
    const onBlur = (): void => publishNow({ kind: "none" });
    const onFocus = (): void => {
      if (timer !== undefined) return; // a queued publish carries the newest state
      publishNow(store.getState().selection);
    };
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBlur);
    window.addEventListener("focus", onFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBlur);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [provider, store]);
}

export { usePresencePublish };
