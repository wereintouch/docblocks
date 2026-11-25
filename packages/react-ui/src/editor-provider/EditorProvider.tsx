/** The per-instance editor provider: the doc + store + selection lifecycle
 *  + the per-instance customization context. */
import { useContext, useEffect, useMemo, useRef, useState } from "react";

import { createSelection } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { getDefaultBlobStore } from "../blob-store";
import type { BlobStore } from "../blob-store";
import type { DatabaseBridge } from "../database";
import { DocblocksI18nProvider } from "../i18n";
import { EditorProviderError } from "../shared/errors";
import { createEditorStore } from "../state";
import { NotPublishedPlaceholder } from "./NotPublishedPlaceholder";
import { defaultEmbedSandbox } from "./constants";
import { EditorContext } from "./context";
import type { EditorMode, EditorProviderProps, SelectionRef } from "./models";
import { usePresencePublish } from "./use-presence-publish";
import { usePresenceReceive } from "./use-presence-receive";
import { useTrailingParagraph } from "./use-trailing-paragraph";

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
  blobLoading,
  scrollContainer,
  databaseBridge,
  syncEmbedResolver,
  pdfPreview,
  mentionProvider,
  mentionInteractions,
  embedSandbox,
  rootBlockId,
  commandPalettePlaceholder,
  accessLevel,
  mode,
  publishedDoc,
  presence,
  hiddenAttributes,
  renderAttribute,
  attributeTypePicker,
  docTags,
  docDescription,
  coverPresets,
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

  useEffect(() => {
    if (docRef.current !== doc) {
      throw new EditorProviderError("EditorProvider: the doc instance must not change after mount.");
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

  // The root's trailing-paragraph guarantee over the doc + the peer's wire
  // writes (the full-doc editing stand only).
  useTrailingParagraph(doc, rootBlockId, effectiveMode === "edit");

  // The store captures the entry root at creation (the useState
  // initializer), so a rootBlockId change after mount desyncs the entry
  // list silently — the guard runs in its own effect (rootId is not a dep
  // of the mount effect). Remount via a `key` change is the sanctioned
  // way to switch roots.
  useEffect(() => {
    if (rootIdRef.current !== rootId) {
      throw new EditorProviderError("EditorProvider: the rootBlockId must not change after mount.");
    }
    rootIdRef.current = rootId;
  }, [rootId]);

  // The awareness session over the sync provider: the remote frames resolve
  // into the presence slice, the local selection publishes over the sharing
  // contract.
  usePresenceReceive(provider, store, presence);
  usePresencePublish(provider, store, presence, effectiveMode !== "edit");

  // The explicit store wins; otherwise inherit the enclosing store or use
  // the shared in-memory default.
  const effectiveBlobStore = useMemo<BlobStore>(
    () => blobStore ?? parentContext?.blobStore ?? getDefaultBlobStore(),
    [blobStore, parentContext]
  );

  // The effective blob loading policy: the explicit prop wins, else the
  // enclosing one, else the lazy default.
  const effectiveBlobLoading = blobLoading ?? parentContext?.blobLoading ?? "lazy";

  // The lazy resolution's band frame: the consumer's own scroll container,
  // else the enclosing one, else the window's scroll. An explicit `null`
  // frames the window over an inherited container (the nested stand's
  // opt-out); only an absent prop inherits.
  const effectiveScrollContainer =
    scrollContainer === undefined ? (parentContext?.scrollContainer ?? null) : scrollContainer;

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
      blobLoading: effectiveBlobLoading,
      scrollContainer: effectiveScrollContainer,
      databaseBridge: effectiveDatabaseBridge,
      syncEmbedResolver: syncEmbedResolver ?? parent?.syncEmbedResolver ?? null,
      pdfPreview: pdfPreview ?? parent?.pdfPreview ?? null,
      mentionProvider: mentionProvider ?? parent?.mentionProvider ?? null,
      mentionInteractions: mentionInteractions ?? parent?.mentionInteractions ?? null,
      hiddenAttributes: hiddenAttributes ?? parent?.hiddenAttributes ?? [],
      renderAttribute: renderAttribute ?? parent?.renderAttribute ?? null,
      attributeTypePicker: attributeTypePicker ?? parent?.attributeTypePicker ?? null,
      docTags: docTags ?? parent?.docTags ?? null,
      docDescription: docDescription ?? parent?.docDescription ?? null,
      coverPresets: coverPresets ?? parent?.coverPresets ?? null,
      embedSandbox: embedSandbox ?? parent?.embedSandbox ?? defaultEmbedSandbox,
      rootBlockId: rootId,
      ancestorDocIds: parent ? [...parent.ancestorDocIds, parent.doc.meta.id] : [],
      embedDepth: parent === null ? 0 : parent.embedDepth + 1,
      commandPalettePlaceholder: commandPalettePlaceholder ?? parent?.commandPalettePlaceholder ?? null,
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
    effectiveBlobLoading,
    effectiveScrollContainer,
    effectiveDatabaseBridge,
    syncEmbedResolver,
    rootId,
    parentContext,
    commandPalettePlaceholder,
    pdfPreview,
    mentionProvider,
    mentionInteractions,
    embedSandbox,
    effectiveAccessLevel,
    effectiveMode,
    presence,
    hiddenAttributes,
    renderAttribute,
    attributeTypePicker,
    docTags,
    docDescription,
    coverPresets,
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
    throw new EditorProviderError(
      "EditorProvider: the doc stand is required over the editor's stand (the viewer's stand stands the placeholder over the absent stand)"
    );
  }
  return <EditorProviderStand {...props} doc={props.doc} />;
}

export { EditorProvider };
