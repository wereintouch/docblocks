import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createSelection, presenceSelectionOf } from "docblocks-core";
import type { Doc, Selection, SelectionView, SyncProvider } from "docblocks-core";

import { createEditorStore } from "./state/store";
import type { EditorStore } from "./state/store";

/** The per-instance selection view; null before the mount effect ran and after unmount. */
interface SelectionRef {
  view: SelectionView | null;
}

/** Per-instance editor context: the store, the doc, and the live selection view handle. */
interface EditorContextValue {
  store: EditorStore;
  doc: Doc;
  selection: SelectionRef;
}

/** Debounce between a selection change and its awareness publish. */
const AWARENESS_DEBOUNCE_MS = 50;

const EditorContext = createContext<EditorContextValue | null>(null);

/** Read the per-instance editor context; throws outside an EditorProvider. */
function useEditorContext(): EditorContextValue {
  const context = useContext(EditorContext);
  if (context === null) throw new Error("Editor hooks must be used inside an EditorProvider.");
  return context;
}

interface EditorProviderProps {
  /** The headless document to render and edit; must not change after mount. */
  doc: Doc;
  /** Optional sync transport for presence (awareness); the doc's own changes are always tracked. */
  provider?: SyncProvider;
  children: ReactNode;
}

/**
 * Owns the per-instance editor lifecycle: the zustand store (projection of
 * the doc), the selection view, and the subscriptions that keep them in
 * sync. Multiple providers may coexist, each with its own doc and state.
 * Safe under StrictMode double-mount: the cleanup detaches every
 * subscription and destroys the view between the two mounts.
 */
function EditorProvider({ doc, provider, children }: EditorProviderProps) {
  const [store] = useState(() => createEditorStore(doc));
  const docRef = useRef(doc);
  const selectionRef = useRef<SelectionRef>({ view: null });

  useEffect(() => {
    if (docRef.current !== doc) {
      throw new Error("EditorProvider: the doc instance must not change after mount.");
    }
    docRef.current = doc;

    const view = createSelection(doc);
    selectionRef.current.view = view;
    const unsubscribeDoc = doc.onChange((change) => store.getState().applyChange(change));
    const unsubscribeSelection = view.onChange((selection) => store.getState().setSelection(selection));

    // Initial sync: seed the selection slice from the view's current state.
    store.getState().setSelection(view.get());

    return () => {
      unsubscribeDoc();
      unsubscribeSelection();
      selectionRef.current.view = null;
      view.destroy();
    };
  }, [doc, store]);

  useEffect(() => {
    if (provider === undefined) return;

    // Transports re-emit the (unchanged) remote peer list on every
    // awareness update — including the one triggered by this provider's
    // own setAwareness — so an unchanged list must not churn the slice
    // reference (reference stability across unrelated changes).
    let lastPeers = "";
    const unsubscribeAwareness = provider.onAwareness((peers) => {
      const serialized = JSON.stringify(peers);
      if (serialized === lastPeers) return;
      lastPeers = serialized;
      store.getState().setPresence(peers);
    });
    return () => unsubscribeAwareness();
  }, [provider, store]);

  // Publish the live local selection into the provider's awareness:
  // debounced on change, a null selection immediately on window blur or
  // page unload, and an immediate re-publish of the current selection on
  // window focus (closing the stale-null gap after a blur). A transport
  // that re-sends the local awareness state on (re)connect (WsSyncProvider
  // does) restores the payload automatically after a reconnect.
  useEffect(() => {
    if (provider === undefined) return;

    const publish = (selection: Selection): void => {
      provider.setAwareness({
        selection: presenceSelectionOf(selection),
        updatedAt: Date.now(),
      });
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const queue = (selection: Selection): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        publish(selection);
      }, AWARENESS_DEBOUNCE_MS);
    };
    const publishNoneNow = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      publish({ kind: "none" });
    };
    const publishCurrentNow = (): void => {
      if (timer !== undefined) return; // a queued publish carries the newest state
      publish(store.getState().selection);
    };

    const unsubscribe = store.subscribe((state, prev) => {
      if (state.selection !== prev.selection) queue(state.selection);
    });
    window.addEventListener("blur", publishNoneNow);
    window.addEventListener("beforeunload", publishNoneNow);
    window.addEventListener("focus", publishCurrentNow);

    return () => {
      unsubscribe();
      window.removeEventListener("blur", publishNoneNow);
      window.removeEventListener("beforeunload", publishNoneNow);
      window.removeEventListener("focus", publishCurrentNow);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [provider, store]);

  const value = useMemo(() => ({ store, doc, selection: selectionRef.current }), [store, doc]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export { EditorProvider, useEditorContext };
export type { EditorContextValue, EditorProviderProps };
