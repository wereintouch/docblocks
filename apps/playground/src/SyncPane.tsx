import { Button, DocHeader, type EditorMode, type EditorView, type SyncEmbedResolver } from "docblocks-react-ui";

import { useEffect, useMemo, useRef, useState } from "react";

import { type Doc, type SyncEmbedRef } from "docblocks-core";

import { DocArea } from "./DocArea";
import { type InspectTab, PaneSystemPanel, TOGGLE_BTN } from "./PaneSystemPanel";
import { CATALOG_MASTER_ID } from "./master";
import { MentionClickBanner } from "./mention-card";
import { currentBlockOf } from "./pane-blocks";
import { loadPublishedSnapshot, publishSnapshot } from "./publish";
import { useSyncRuntime } from "./use-sync-runtime";
import { useBlockLabels } from "./useBlockLabels";

/**
 * One sync client pane. Both panes create the same document and the same
 * master doc (the sync-embed target, shared through the `<room>-master`
 * room) and attach one WsSyncProvider each (the useSyncRuntime hook), so
 * edits and carets converge through the relay. The doc area is the real
 * editor (the DocArea: EditorProvider + Editor on the same doc/provider
 * instance): typing is the real editor, the pane's awareness is published
 * by the provider from the real DOM selection, and the pane's sync-embed
 * resolver points at its master.
 * The editor area always renders the base `Editor` (the motion page view
 * is the Editor's default — the harness helpers target the block wrappers
 * the motion layer keeps);
 * `catalog` builds the deterministic v1 catalog document
 * (catalog.ts) instead of seeding a paragraph (the goldens' fixture; the
 * live doc on `window.__catalogDoc`); `cycle` seeds the master with a
 * sync-embed referencing the outer doc (the cycle-guard e2e case).
 *
 * The pane's system panel (the right-hand column) shows its inspectors
 * (JSON / Wire / Presence tabs): all three stay mounted, the tabs only
 * toggle visibility — the subscriptions live in the runtime hook, so a
 * hidden inspector keeps updating and its testid stays queryable.
 */
function SyncPane({
  client,
  syncUrl,
  catalog,
  canvas,
  heavy,
  cycle,
  role,
  attrDemo,
  blobEager,
  longdoc,
}: {
  client: "a" | "b";
  syncUrl: string;
  catalog: boolean;
  canvas: boolean;
  heavy: boolean;
  cycle: boolean;
  role: "editor" | "viewer";
  attrDemo: boolean;
  blobEager: boolean;
  /** The long-document seed's image count (0 when the mode stands off). */
  longdoc: number;
}) {
  const docAreaRef = useRef<HTMLDivElement | null>(null);

  // The pane's master id: deterministic per room; the catalog pane's master
  // has a fixed id (the catalog's JSON golden is byte-stable).
  const room = syncUrl.split("/").pop() ?? syncUrl;
  const masterDocId = catalog ? CATALOG_MASTER_ID : `master-${room}`;

  const { runtime, connected, blocks, presence, wire, onReconnect } = useSyncRuntime({
    client,
    syncUrl,
    catalog,
    canvas,
    heavy,
    longdoc,
    cycle,
    role,
    masterDocId,
  });

  /** The view mode (page / canvas): view state only — switching writes nothing to the doc. */
  const [view, setView] = useState<EditorView>(canvas || heavy ? "canvas" : "page");
  /** The consumer's document mode: the editor's mode is controlled; the viewer's mode is forced to published (the package's resolution — the harness stands the editor's controlled stand). */
  const [mode, setMode] = useState<EditorMode>("edit");
  /** The published snapshot (the consumer's publish stand: the room's shared localStorage stand, the publish.ts); null over the absent stand. */
  const [publishedDoc, setPublishedDoc] = useState<Doc | null>(() => loadPublishedSnapshot(room));
  /** The snapshot stand's seq (a fresh instance per load — the viewer's provider remounts over the new stand: the doc instance must not change over a mounted provider). */
  const [publishedSeq, setPublishedSeq] = useState(0);
  /** The harness theme (dark/light): view state only — the `.dark` class on `<html>` flips the package's dark token set; dark is the harness default. */
  const [dark, setDark] = useState(true);
  /** The cover preset's gallery's stand (the consumer's `coverPresets` prop's demo): on by default (the feature's visible stand), the toggle's off stands the no-preset's layout. */
  const [coverPresetsOn, setCoverPresetsOn] = useState(true);
  const [tab, setTab] = useState<InspectTab>("json");
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);

  useBlockLabels(docAreaRef, blocks, currentId, client);

  // The theme lands on `<html>` (the package's dark set activates via the
  // `.dark` class on any ancestor); the module-level default in main.tsx
  // pre-applies it before the first paint so a dark default never flashes.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // The sync-embed resolver: the pane's master for the master id, null for
  // any other docId (a stable reference per runtime — the provider reads
  // it per render).
  const syncEmbedResolver = useMemo<SyncEmbedResolver | undefined>(() => {
    const master = runtime?.master;
    if (master === undefined) return undefined;
    return (ref: SyncEmbedRef) => (ref.docId === masterDocId ? master.doc : null);
  }, [runtime, masterDocId]);

  // The harness runs exactly two clients, so a remote peer is the other one.
  const peerLetter = client === "a" ? "b" : "a";

  // The consumer's publish stand (the harness's own storage — the package
  // owns no publish state): the room's state becomes the published
  // snapshot (the shared localStorage stand — the peer's pane reads the
  // same stand over its reload / re-read).
  const onPublish = () => {
    if (runtime === null) return;
    publishSnapshot(room, runtime.doc);
    setPublishedDoc(loadPublishedSnapshot(room));
    setPublishedSeq((seq) => seq + 1);
  };

  // The e2e's re-read path: the viewer's pane re-reads the room's published
  // stand after the editor's pane published (the shared localStorage stand
  // is the consumer's persistence — the panes are the same consumer).
  useEffect(() => {
    window.__reloadPublished = (letter) => {
      if (letter !== client) return true;
      const snapshot = loadPublishedSnapshot(room);
      setPublishedDoc(snapshot);
      if (snapshot !== null) setPublishedSeq((seq) => seq + 1);
      return snapshot !== null;
    };
    return () => {
      window.__reloadPublished = undefined;
    };
  }, [client, room]);

  // main must stay content-height (a viewport-pinned fixed height makes
  // Chrome swallow the default Home/End caret moves inside the nested
  // contenteditable); the canvas view carries its own definite height for
  // the editor's flex chain.
  return (
    <main className="doc-main">
      {/* The mention interactions' demo's click banner (the consumer's
          stand over the provider's delivery). */}
      <MentionClickBanner />
      {/* The component under test: the page flow or the document canvas. */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>docblocks — {client}</h1>
          {(role === "viewer" || runtime !== null) && (
            <>
              {role === "editor" && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`publish-${client}`}
                  className={TOGGLE_BTN}
                  onClick={onPublish}
                >
                  publish
                </Button>
              )}
              <DocHeader
                // The viewer's stand: the doc is the published snapshot (the
                // only stand the consumer passes — the live's doc stands no
                // stand; the absent stand stands the header's neutral's
                // stand over the placeholder's card).
                doc={role === "viewer" ? (publishedDoc ?? undefined) : runtime?.doc}
                view={view}
                onViewChange={setView}
                accessLevel={role}
                mode={mode}
                onModeChange={setMode}
                publishedDoc={role === "viewer" ? null : publishedDoc}
              />
            </>
          )}
        </header>
        <DocArea
          client={client}
          role={role}
          view={view}
          mode={mode}
          publishedDoc={publishedDoc}
          publishedSeq={publishedSeq}
          runtime={runtime}
          syncEmbedResolver={syncEmbedResolver}
          catalog={catalog}
          blobEager={blobEager}
          coverPresetsOn={coverPresetsOn}
          attrDemo={attrDemo}
          peerLetter={peerLetter}
          docAreaRef={docAreaRef}
        />
      </section>
      <PaneSystemPanel
        client={client}
        role={role}
        syncUrl={syncUrl}
        connected={connected}
        onReconnect={onReconnect}
        dark={dark}
        onDarkChange={setDark}
        coverPresetsOn={coverPresetsOn}
        onCoverPresetsChange={setCoverPresetsOn}
        runtime={runtime}
        wire={wire}
        presence={presence}
        tab={tab}
        onTabChange={setTab}
        peerLetter={peerLetter}
      />
    </main>
  );
}

export { SyncPane };
