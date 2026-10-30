/** The per-instance editor provider: the doc + store + selection lifecycle
 *  + the per-instance customization context. */
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { BLOCK_REGISTRY, createSelection, presenceSelectionOf } from "docblocks-core";
import type { Selection } from "docblocks-core";

import { getDefaultBlobStore, legacyBlobStore } from "../blob-store";
import type { BlobStore } from "../blob-store";
import { getDefaultDatabaseBridge } from "../database";
import type { DatabaseBridge } from "../database";
import { ensureTrailingParagraph } from "../editing/block-commands";
import { COMMAND_PALETTE_PLACEHOLDER } from "../editing/slash";
import { createEditorStore } from "../state";
import { AWARENESS_DEBOUNCE_MS, defaultEmbedSandbox } from "./constants";
import { EditorContext } from "./context";
import type { EditorProviderProps, SelectionRef } from "./models";

/**
 * Owns the per-instance editor lifecycle: the zustand store (projection of
 * the doc), the selection view, and the subscriptions that keep them in
 * sync, and the per-instance customization context (consumer block
 * renderers, blob and sync-embed resolvers, the entry-list root). Multiple
 * providers may coexist, each with its own doc and state; a nested provider
 * inherits the enclosing renderers, resolvers, and the ancestor-doc chain
 * (the sync-embed cycle guards) when it supplies none of its own. Safe
 * under StrictMode double-mount: the cleanup detaches every subscription
 * and destroys the view between the two mounts.
 */
function EditorProvider({
  doc,
  provider,
  blockRenderers,
  blobResolver,
  blobStore,
  databaseBridge,
  syncEmbedResolver,
  pdfPreview,
  mentionProvider,
  embedSandbox,
  rootBlockId,
  commandPalettePlaceholder,
  children,
}: EditorProviderProps) {
  const rootId = rootBlockId ?? doc.meta.id;
  const [store] = useState(() => createEditorStore(doc, rootId));
  const docRef = useRef(doc);
  const rootIdRef = useRef(rootId);
  const selectionRef = useRef<SelectionRef>({ view: null });
  // The raw enclosing context (nullable): the inheritance source for the
  // renderers, resolvers, and the cycle-guard chain/depth.
  const parentContext = useContext(EditorContext);

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

    // The document root's tail guarantee (the session's start stand): a
    // doc that stands a non-text last block (the external data, the
    // peer's mid-session stand) has no caret home over its end — the
    // empty paragraph stands after it. The empty doc stands no stand here
    // (the starter's seeder owns the empty room, the empty hint owns the
    // empty editor), the text tail stands no write (no no-op transact —
    // a mount with nothing to stand must not stamp the doc), and the
    // subtree providers' sequence ends are the consumer's stand.
    if (rootBlockId === undefined) {
      const sequence = doc.getChildren(doc.meta.id);
      const lastId = sequence[sequence.length - 1];
      const last = lastId === undefined ? null : doc.getBlock(lastId);
      if (last !== null && !BLOCK_REGISTRY[last.type].content) {
        doc.transact(() => {
          ensureTrailingParagraph(doc, doc.meta.id);
        });
      }
    }

    // The tail guarantee's remote feed (full-doc editors only): a peer's
    // write that leaves the tail non-text (a seed load over the wire, a
    // foreign writer) stands its trailing paragraph over the wire. The
    // feed is remote-only — the local gesture paths (the removal, the
    // slash's insert, the drag's commit) stand their own paragraph inside
    // their one transact, and a local-origin guard would double-stand the
    // paragraph over the peer's guard of the same write. The check runs
    // once the in-flight transaction settles (a microtask) so the
    // insertion commits as its own LOCAL transaction: a guard write inside
    // the remote transaction would stand the remote origin and the
    // origin guard would keep it off the wire.
    let unsubscribeTail: (() => void) | null = null;
    if (rootBlockId === undefined) {
      unsubscribeTail = doc.onRemoteChange(() => {
        void queueMicrotask(() => {
          ensureTrailingParagraph(doc, doc.meta.id);
        });
      });
    }

    return () => {
      unsubscribeDoc();
      unsubscribeSelection();
      if (unsubscribeTail !== null) unsubscribeTail();
      selectionRef.current.view = null;
      view.destroy();
    };
  }, [doc, store]);

  // The store captures the entry root at creation (the useState
  // initializer), so a rootBlockId change after mount desyncs the entry
  // list silently — the guard runs in its own effect (rootId is not a dep
  // of the mount effect). Remount via a `key` change is the sanctioned
  // way to switch roots.
  useEffect(() => {
    if (rootIdRef.current !== rootId) {
      throw new Error("EditorProvider: the rootBlockId must not change after mount.");
    }
    rootIdRef.current = rootId;
  }, [rootId]);

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

  // The effective blob bridge: the explicit store wins; the legacy
  // resolver wraps as a view-only store; neither falls back to the
  // enclosing store, then the shared default in-memory store.
  const effectiveBlobStore = useMemo<BlobStore>(
    () =>
      blobStore ??
      (blobResolver !== undefined
        ? legacyBlobStore(blobResolver)
        : (parentContext?.blobStore ?? getDefaultBlobStore())),
    [blobStore, blobResolver, parentContext]
  );

  // The effective database bridge: the explicit bridge wins, else the
  // enclosing one, then the shared default in-memory bridge.
  const effectiveDatabaseBridge = useMemo<DatabaseBridge>(
    () => databaseBridge ?? parentContext?.databaseBridge ?? getDefaultDatabaseBridge(),
    [databaseBridge, parentContext]
  );

  const value = useMemo(() => {
    const parent = parentContext;
    return {
      store,
      doc,
      selection: selectionRef.current,
      renderers: blockRenderers ?? parent?.renderers ?? {},
      blobStore: effectiveBlobStore,
      databaseBridge: effectiveDatabaseBridge,
      syncEmbedResolver: syncEmbedResolver ?? parent?.syncEmbedResolver ?? null,
      pdfPreview: pdfPreview ?? parent?.pdfPreview ?? null,
      mentionProvider: mentionProvider ?? parent?.mentionProvider ?? null,
      embedSandbox: embedSandbox ?? parent?.embedSandbox ?? defaultEmbedSandbox,
      rootBlockId: rootId,
      ancestorDocIds: parent ? [...parent.ancestorDocIds, parent.doc.meta.id] : [],
      embedDepth: parent === null ? 0 : parent.embedDepth + 1,
      commandPalettePlaceholder:
        commandPalettePlaceholder ?? parent?.commandPalettePlaceholder ?? COMMAND_PALETTE_PLACEHOLDER,
    };
  }, [
    store,
    doc,
    blockRenderers,
    effectiveBlobStore,
    effectiveDatabaseBridge,
    syncEmbedResolver,
    rootId,
    parentContext,
    commandPalettePlaceholder,
    pdfPreview,
    mentionProvider,
    embedSandbox,
  ]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

export { EditorProvider };
