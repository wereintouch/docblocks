/** The per-instance editor provider: the doc + store + selection lifecycle
 *  + the per-instance customization context. */
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { BLOCK_REGISTRY, createSelection, presenceSelectionOf } from "docblocks-core";
import type { Doc, PresenceState, Selection } from "docblocks-core";

import { getDefaultBlobStore } from "../blob-store";
import type { BlobStore } from "../blob-store";
import type { DatabaseBridge } from "../database";
import { ensureTrailingParagraph } from "../editing/block-commands";
import { COMMAND_PALETTE_PLACEHOLDER } from "../editing/slash";
import { DocblocksI18nProvider } from "../i18n";
import { buildPresencePayload, resolvePeerSelection } from "../presence";
import { createEditorStore } from "../state";
import { NotPublishedPlaceholder } from "./NotPublishedPlaceholder";
import { AWARENESS_DEBOUNCE_MS, defaultEmbedSandbox } from "./constants";
import { EditorContext } from "./context";
import type { EditorMode, EditorProviderProps, SelectionRef } from "./models";

// The published snapshot's stand key (a module stand, one seq per snapshot
// instance): the nested published provider remounts over a NEW snapshot
// (the doc's stand must not change over a mounted provider — the doc's
// stand guard) and keeps its stand over the same snapshot (no re-mount
// over the re-render).
const SNAPSHOT_KEYS = new WeakMap<object, number>();
let SNAPSHOT_KEY_SEQ = 0;

function publishedStandKey(doc: Doc): string {
  let key = SNAPSHOT_KEYS.get(doc);
  if (key === undefined) {
    key = SNAPSHOT_KEY_SEQ;
    SNAPSHOT_KEY_SEQ += 1;
    SNAPSHOT_KEYS.set(doc, key);
  }
  return `published-${key}`;
}

/**
 * The stand: owns the per-instance editor lifecycle — the zustand store
 * (projection of the doc), the selection view, and the subscriptions that
 * keep them in sync, and the per-instance customization context (consumer
 * block renderers, blob and sync-embed resolvers, the entry-list root).
 * Multiple providers may coexist, each with its own doc and state; a nested
 * provider inherits the enclosing renderers, resolvers, and the
 * ancestor-doc chain (the sync-embed cycle guards) when it supplies none of
 * its own. Safe under StrictMode double-mount: the cleanup detaches every
 * subscription and destroys the view between the two mounts.
 */
function EditorProviderStand({
  doc,
  provider,
  blockRenderers,
  blobStore,
  databaseBridge,
  syncEmbedResolver,
  pdfPreview,
  mentionProvider,
  embedSandbox,
  rootBlockId,
  commandPalettePlaceholder,
  accessLevel,
  mode,
  publishedDoc,
  presence,
  children,
}: EditorProviderProps & { doc: Doc }) {
  const rootId = rootBlockId ?? doc.meta.id;
  const [store] = useState(() => createEditorStore(doc, rootId));
  const docRef = useRef(doc);
  const rootIdRef = useRef(rootId);
  const selectionRef = useRef<SelectionRef>({ view: null, reseatUntil: { current: 0 } });
  // The raw enclosing context (nullable): the inheritance source for the
  // renderers, resolvers, and the cycle-guard chain/depth.
  const parentContext = useContext(EditorContext);
  // The effective access stand: the own prop, else the enclosing one, else
  // the default editor. The effective mode: a viewer stands "published" over
  // any stand (the current state is never rendered for a reader); an editor
  // stands the own `mode`, else the enclosing one, else the default "edit".
  const effectiveAccessLevel = accessLevel ?? parentContext?.accessLevel ?? "editor";
  const effectiveMode: EditorMode =
    effectiveAccessLevel === "viewer" ? "published" : (mode ?? parentContext?.mode ?? "edit");
  // The editing stand over the mount (the guarantee's write gate): a
  // read-only stand (view / published) never runs the tail guarantee's
  // write — the published's snapshot stands static over the render and a
  // read-only subtree must not write into its own doc (the embedded's
  // master over the published's stand is read-only too).
  const editingStandRef = useRef(effectiveMode === "edit");
  // The presence identity + cipher and the read-only stand are read at
  // publish/receive time (the awareness effects stay keyed on provider /
  // store — a fresh inline presence prop must not re-subscribe them).
  const presenceRef = useRef(presence);
  presenceRef.current = presence;
  const viewModeRef = useRef(effectiveMode !== "edit");
  viewModeRef.current = effectiveMode !== "edit";

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
    // subtree providers' sequence ends are the consumer's stand. A
    // read-only stand skips the write (the snapshot's stand above).
    if (rootBlockId === undefined && editingStandRef.current) {
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
    if (rootBlockId === undefined && editingStandRef.current) {
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

  // Publish the local selection state into the provider's awareness over
  // the sharing contract: the grant is session state (the store's sharing
  // slice, the default "off" — the privacy stand): "off" / the read-only
  // stand publishes the identity only, "everyone" publishes the plaintext
  // selection (the legacy stand), and a targeted grant encrypts per target
  // over the consumer's cipher (no cipher — the publish stands dropped).
  // Debounced on change, identity-only immediately on window blur or page
  // unload, and an immediate re-publish on window focus (closing the
  // stale-null gap after a blur). A transport that re-sends the local
  // awareness state on (re)connect (WsSyncProvider does) restores the
  // payload automatically after a reconnect.
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

  // The explicit store wins; otherwise inherit the enclosing store or use
  // the shared in-memory default.
  const effectiveBlobStore = useMemo<BlobStore>(
    () => blobStore ?? parentContext?.blobStore ?? getDefaultBlobStore(),
    [blobStore, parentContext]
  );

  // The effective database bridge: the explicit bridge wins, else the
  // enclosing one; without a bridge the external-form database blocks
  // render the disconnected placeholder (the inline form stands
  // unchanged — its data is the document's own).
  const effectiveDatabaseBridge = useMemo<DatabaseBridge | undefined>(
    () => databaseBridge ?? parentContext?.databaseBridge,
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
      accessLevel: effectiveAccessLevel,
      mode: effectiveMode,
      viewMode: effectiveMode !== "edit",
      presence: presence ?? null,
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
    effectiveAccessLevel,
    effectiveMode,
    presence,
  ]);

  // The published's stand: a read-only nested provider over the consumer's
  // snapshot (its own store and selection, no sync transport — the snapshot
  // stands static over the render; the resolvers and the rootBlockId inherit
  // over the enclosing's stand — the snapshot carries the same block ids),
  // or the not-published's placeholder over the stand without a snapshot.
  // The top-level viewer's stand renders its own doc read-only, directly:
  // the doc IS the published snapshot (the security stand — the reader's
  // browser never holds the live document, and no separate snapshot prop).
  // A provider that INHERITS the published stand (the nested snapshot's
  // provider itself, the sync-embed over the published's stand) carries the
  // read-only stand over the context and renders its children over its own
  // doc — it never re-stands the stand.
  const inheritedPublishedStand = parentContext !== null && parentContext.mode === "published";
  const viewerStand = effectiveAccessLevel === "viewer" && parentContext === null;
  const rendered = viewerStand ? (
    children
  ) : effectiveMode === "published" ? (
    publishedDoc !== undefined && publishedDoc !== null ? (
      <EditorProvider key={publishedStandKey(publishedDoc)} doc={publishedDoc} rootBlockId={rootId}>
        {children}
      </EditorProvider>
    ) : inheritedPublishedStand ? (
      children
    ) : (
      <NotPublishedPlaceholder />
    )
  ) : (
    children
  );

  return (
    <DocblocksI18nProvider>
      <EditorContext.Provider value={value}>{rendered}</EditorContext.Provider>
    </DocblocksI18nProvider>
  );
}

/**
 * The provider's entry: resolves the viewer's top-level stand before the
 * stand's hooks (the security stand — the reader's browser never holds the
 * live document: over the `viewer`'s level the `doc` is the published
 * snapshot, the only stand the consumer passes, and an absent stand stands
 * the not-published placeholder — the document was never published). The
 * editor's stand requires the doc (an explicit throw over the absent
 * stand).
 */
function EditorProvider(props: EditorProviderProps) {
  const parentContext = useContext(EditorContext);
  const accessLevel = props.accessLevel ?? parentContext?.accessLevel ?? "editor";
  if (accessLevel === "viewer" && parentContext === null) {
    if (props.doc === undefined)
      return (
        <DocblocksI18nProvider>
          <NotPublishedPlaceholder />
        </DocblocksI18nProvider>
      );
    return <EditorProviderStand {...props} doc={props.doc} />;
  }
  if (props.doc === undefined) {
    throw new Error(
      "EditorProvider: the doc stand is required over the editor's stand (the viewer's stand stands the placeholder over the absent stand)"
    );
  }
  return <EditorProviderStand {...props} doc={props.doc} />;
}

export { EditorProvider };
