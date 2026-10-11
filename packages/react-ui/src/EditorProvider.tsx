import { type ReactNode, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createSelection } from "docblocks-core";
import type { Doc, SelectionView, SyncProvider } from "docblocks-core";

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
    const unsubscribe = provider?.onAwareness((peers) => store.getState().setPresence(peers));
    return () => unsubscribe?.();
  }, [provider, store]);

  const value = useMemo(() => ({ store, doc, selection: selectionRef.current }), [store, doc]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export { EditorProvider, useEditorContext };
export type { EditorContextValue, EditorProviderProps };
