import {
  type BlockRendererMap,
  Button,
  DocHeader,
  Editor,
  type EditorMode,
  EditorProvider,
  type EditorView,
  type PresenceConfig,
  cn,
} from "docblocks-react-ui";
import type { SyncEmbedResolver } from "docblocks-react-ui";
import { MermaidCodeRenderer } from "docblocks-react-ui/mermaid";
import { PdfFirstPage } from "docblocks-react-ui/pdf";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { type Doc, type PresenceState, type SyncEmbedRef, WsSyncProvider, attach } from "docblocks-core";

import { ChaosBar } from "./ChaosBar";
import { createCanvasDoc } from "./canvas-seed";
import { DOC_ID, seedPaneDoc } from "./catalog";
import { blobStore, databaseBridge, insertBlockOf } from "./insert-blocks";
import type { InsertableType } from "./insert-blocks";
import { BridgeInspector } from "./inspect/BridgeInspector";
import { JsonInspector } from "./inspect/JsonInspector";
import { PresencePanel } from "./inspect/PresencePanel";
import { PresenceShareControl } from "./inspect/PresenceShareControl";
import { type WireEvent, WireLog } from "./inspect/WireLog";
import { CATALOG_MASTER_ID, createMasterRuntime, destroyMasterRuntime } from "./master";
import type { MasterRuntime } from "./master";
import { mentionProvider } from "./mention-provider";
import { currentBlockOf, readBlocks } from "./pane-blocks";
import type { PaneBlock } from "./pane-blocks";
import { loadPublishedSnapshot, publishSnapshot } from "./publish";
import { stubPresenceCrypto } from "./stub-crypto";
import { useBlockLabels } from "./useBlockLabels";

/** The wire log keeps the last N events. */
const WIRE_CAP = 50;

declare global {
  interface Window {
    /** Harness-only: the live docs of the mounted panes (per letter; null until the pane's effect ran); the e2e suite drives the command API through them. */
    __paneDocs?: { a: Doc | null; b: Doc | null };
    /** Harness-only: the pane's default database bridge (the e2e bridge suite drives it; the state is per page). */
    __bridge?: import("docblocks-react-ui").DatabaseBridge;
    /** Harness-only: the mounted panes' master docs (the sync-embed targets, per letter; null until the pane's effect ran); the e2e suite drives the master's command API through them. */
    __masterDocs?: { a: Doc | null; b: Doc | null };
    /** Harness-only: inserts a v1 block of `type` into the pane's doc with the harness attrs (see insert-blocks.ts) and returns its id (null if the pane is not mounted); the e2e suite's insert path in place of the removed insert controls. */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
    /** Harness-only: re-reads the room's published snapshot from the shared stand (the publish.ts's localStorage) and applies it to the pane's published stand (the e2e's A/B flow: the editor's pane publishes, the viewer's pane re-reads); true when a stand was applied. */
    __reloadPublished?: (client: "a" | "b") => boolean;
  }
}

/**
 * The pane's renderer map (the demo of the `./mermaid` subpath): a
 * `code` block with `language: "mermaid"` renders the code/preview modes
 * (the default code mode) — every other code block falls through to the
 * built-in rendering inside the renderer. Module-level: the provider
 * reads the map per render, so the reference must be stable.
 */
const BLOCK_RENDERERS: BlockRendererMap = { code: MermaidCodeRenderer };

/**
 * The panes' presence identity (the sharing's stand: the module-level
 * stable reference — the provider reads the prop per render, and a fresh
 * inline object would churn the context value). The user id is the pane's
 * letter suffixed (the e2e's target/stranger grants stand the ids), the
 * cipher is the harness's stub (the orchestration's demo — the e2e checks
 * the privacy property, not the cryptography).
 */
const PRESENCE: Record<"a" | "b", PresenceConfig> = {
  a: { userId: "user-a", name: "User A", crypto: stubPresenceCrypto("user-a") },
  b: { userId: "user-b", name: "User B", crypto: stubPresenceCrypto("user-b") },
};

/** The inspector tabs in the pane's system panel. */
const TABS = ["json", "wire", "presence", "bridge"] as const;
type InspectTab = (typeof TABS)[number];

/**
 * The pane's live doc + provider pair; null before the mount effect ran.
 * The viewer's pane stands no runtime (the security stand — the reader's
 * browser never holds the live document and its transport: the pane
 * renders the published snapshot stand read-only).
 */
interface Runtime {
  doc: Doc;
  provider: WsSyncProvider;
  /** The pane's master (the sync-embed target) and its relay client. */
  master: MasterRuntime;
  /** Unix ms of the runtime mount; the wire/presence stamps are relative to it. */
  mountedAt: number;
}

/**
 * One sync client pane. Both panes create the same document and the same
 * master doc (the sync-embed target, shared through the `<room>-master`
 * room) and attach one WsSyncProvider each, so edits and carets converge
 * through the relay. The doc area is the real editor (EditorProvider +
 * Editor on the same doc/provider instance): typing is the real editor,
 * the pane's awareness is published by the provider from the real DOM
 * selection, and the pane's sync-embed resolver points at its master.
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
 * toggle visibility — the subscriptions live in the runtime effect, so a
 * hidden inspector keeps updating and its testid stays queryable.
 */
function SyncPane({
  client,
  syncUrl,
  catalog,
  canvas,
  cycle,
  role,
}: {
  client: "a" | "b";
  syncUrl: string;
  catalog: boolean;
  canvas: boolean;
  cycle: boolean;
  role: "editor" | "viewer";
}) {
  const docRef = useRef<Doc | null>(null);
  const providerRef = useRef<WsSyncProvider | null>(null);
  const docAreaRef = useRef<HTMLDivElement | null>(null);
  /** The wire log's per-pane event counter (capped list, unique key). */
  const wireSeq = useRef(0);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [connected, setConnected] = useState(false);
  const [blocks, setBlocks] = useState<PaneBlock[]>([]);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [wire, setWire] = useState<WireEvent[]>([]);
  const [tab, setTab] = useState<InspectTab>("json");
  /** The view mode (page / canvas): view state only — switching writes nothing to the doc. */
  const [view, setView] = useState<EditorView>(canvas ? "canvas" : "page");
  /** The consumer's document mode: the editor's mode is controlled; the viewer's mode is forced to published (the package's resolution — the harness stands the editor's controlled stand). */
  const [mode, setMode] = useState<EditorMode>("edit");
  /** The published snapshot (the consumer's publish stand: the room's shared localStorage stand, the publish.ts); null over the absent stand. */
  const [publishedDoc, setPublishedDoc] = useState<Doc | null>(() =>
    loadPublishedSnapshot(syncUrl.split("/").pop() ?? syncUrl)
  );
  /** The snapshot stand's seq (a fresh instance per load — the viewer's provider remounts over the new stand: the doc instance must not change over a mounted provider). */
  const [publishedSeq, setPublishedSeq] = useState(0);
  /** The harness theme (dark/light): view state only — the `.dark` class on `<html>` flips the package's dark token set; dark is the harness default. */
  const [dark, setDark] = useState(true);
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);

  // The theme lands on `<html>` (the package's dark set activates via the
  // `.dark` class on any ancestor); the module-level default in main.tsx
  // pre-applies it before the first paint so a dark default never flashes.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // The pane's master id: deterministic per room; the catalog pane's master
  // has a fixed id (the catalog's JSON golden is byte-stable), and the
  // sync-embed resolver: the pane's master for the master id, null for any
  // other docId (a stable reference per runtime — the provider reads it per
  // render).
  const room = syncUrl.split("/").pop() ?? syncUrl;
  const masterDocId = catalog ? CATALOG_MASTER_ID : `master-${room}`;
  const syncEmbedResolver = useMemo<SyncEmbedResolver | undefined>(() => {
    const master = runtime?.master;
    if (master === undefined) return undefined;
    return (ref: SyncEmbedRef) => (ref.docId === masterDocId ? master.doc : null);
  }, [runtime, masterDocId]);

  // One provider per mount. StrictMode's dev double-mount is safe: the first
  // instance's bytes are only buffered (the socket opens after cleanup) and
  // are dropped by destroy() before reaching the wire.
  useEffect(() => {
    // The viewer's stand (the security stand — the reader's browser never
    // holds the live document): no doc, no relay, no master — the pane
    // stands the published snapshot stand (the `publishedDoc`'s state, the
    // publish.ts's shared stand) read-only. The live stand is never
    // mounted (the fixture pins the absent stand over
    // window.__paneDocs).
    if (role === "viewer") {
      window.__paneDocs = {
        a: client === "a" ? null : (window.__paneDocs?.a ?? null),
        b: client === "b" ? null : (window.__paneDocs?.b ?? null),
      };
      // The bridge stands over the viewer too (the snapshot's database's
      // blocks stand the grid over the bridge's read path).
      window.__bridge = databaseBridge;
      // The stand is ready (no relay — the snapshot's stand, the consumer's
      // persistence).
      setConnected(true);
      return () => {
        window.__paneDocs = {
          a: client === "a" ? null : (window.__paneDocs?.a ?? null),
          b: client === "b" ? null : (window.__paneDocs?.b ?? null),
        };
        setConnected(false);
      };
    }
    // One seeder per room (the pane doc convention): client a seeds the
    // deterministic canvas doc, client b joins empty.
    const doc = canvas ? createCanvasDoc(client === "a") : seedPaneDoc(catalog);
    const provider = new WsSyncProvider(syncUrl);
    const mountedAt = Date.now();
    // The pane's master (the sync-embed target): pane a seeds it, pane b
    // joins it empty — both share the `<room>-master` room.
    const master = createMasterRuntime(masterDocId, syncUrl, cycle ? DOC_ID : null, client === "a");

    const addWire = (dir: "out" | "in", bytes: number): void => {
      wireSeq.current += 1;
      // The event is built here, not inside the updater: the updater runs
      // later (and twice under StrictMode), so it must be pure and read no
      // mutable state — a burst of events would otherwise share the latest id.
      const event: WireEvent = { id: wireSeq.current, at: Date.now() - mountedAt, dir, bytes };
      setWire((prev) => [...prev, event].slice(-WIRE_CAP));
    };
    // Instance-level observation of outgoing updates: the attach glue calls
    // provider.sendUpdate as an instance property at event time, so wrapping
    // the method catches every outgoing update. The provider object is
    // pane-owned, so the wrap only adds this pane's log entry and changes
    // nothing about the transport. Installed before attach so the
    // attach-time bootstrap update (the full-state send) is logged too.
    const originalSendUpdate = provider.sendUpdate.bind(provider);
    provider.sendUpdate = (bytes: Uint8Array): void => {
      addWire("out", bytes.length);
      originalSendUpdate(bytes);
    };

    const session = attach(doc, provider);
    docRef.current = doc;
    providerRef.current = provider;

    const unsubscribeWire = provider.onUpdate((bytes) => addWire("in", bytes.length));

    // The plain room's starter paragraph: pane "a" is the designated
    // seeder (pane "b" never seeds, so a fresh room gets exactly one
    // starter). The seed waits for the sync to settle — the first
    // incoming update (the room's state, or the peer's skeleton) or a
    // settle timeout — and inserts the starter only while the root still
    // has no children (a room with surviving content resyncs against it
    // on a reload and is never re-seeded).
    let starterSettled = false;
    let settleTimer = 0;
    const finishStarter = (): void => {
      if (starterSettled) return;
      starterSettled = true;
      window.clearTimeout(settleTimer);
      unsubscribeSettle?.();
      if (doc.getChildren(DOC_ID).length === 0) {
        doc.insertBlock("paragraph");
      }
    };
    let unsubscribeSettle: (() => void) | null = null;
    if (client === "a" && !catalog && !canvas) {
      unsubscribeSettle = provider.onUpdate(finishStarter);
      settleTimer = window.setTimeout(finishStarter, 1000);
    }

    const refresh = () => setBlocks(readBlocks(doc));
    const unsubscribeDoc = doc.onChange(refresh);
    // Initial read: the catalog is seeded before this subscription.
    refresh();
    // The provider reports remote peers only (its own awareness state is
    // excluded by client id), so the list needs no self-filtering.
    const unsubscribePresence = provider.onAwareness((peers) => setPresence(peers));

    // The catalog pane exposes its live doc for the e2e JSON golden.
    if (catalog) {
      window.__catalogDoc = doc;
    }

    // The pane's live doc (per letter) for the e2e command-API tests;
    // the other letter keeps its own pane's doc (separate pages).
    window.__paneDocs = {
      a: client === "a" ? doc : (window.__paneDocs?.a ?? null),
      b: client === "b" ? doc : (window.__paneDocs?.b ?? null),
    };

    // The pane's default database bridge for the e2e bridge suite (the
    // bridge state is per page; the event echo converges the panes).
    window.__bridge = databaseBridge;

    // The pane's master doc (per letter) for the e2e tests that drive the
    // sync-embed master's command API (the peer-side edits into the
    // subtree's derived segment).
    window.__masterDocs = {
      a: client === "a" ? master.doc : (window.__masterDocs?.a ?? null),
      b: client === "b" ? master.doc : (window.__masterDocs?.b ?? null),
    };

    void (async () => {
      try {
        await provider.connect();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    })();
    setRuntime({ doc, provider, master, mountedAt });

    return () => {
      window.clearTimeout(settleTimer);
      if (unsubscribeSettle !== null) unsubscribeSettle();
      unsubscribeDoc();
      unsubscribePresence();
      unsubscribeWire();
      session.detach();
      provider.destroy();
      destroyMasterRuntime(master);
      docRef.current = null;
      providerRef.current = null;
      window.__catalogDoc = null;
      window.__paneDocs = {
        a: client === "a" ? null : (window.__paneDocs?.a ?? null),
        b: client === "b" ? null : (window.__paneDocs?.b ?? null),
      };
      window.__masterDocs = {
        a: client === "a" ? null : (window.__masterDocs?.a ?? null),
        b: client === "b" ? null : (window.__masterDocs?.b ?? null),
      };
      setConnected(false);
      setBlocks([]);
      setPresence([]);
      setWire([]);
      setRuntime(null);
    };
  }, [syncUrl, catalog, canvas, cycle, masterDocId, client, role]);

  useBlockLabels(docAreaRef, blocks, currentId, client);

  /**
   * The e2e insert path: inserts the v1 type into this pane's doc with the
   * harness attrs (see insert-blocks.ts) and returns the block id.
   */
  useEffect(() => {
    window.__insertBlock = (letter, type) => {
      const doc = docRef.current;
      if (letter !== client || doc === null || runtime === null) return null;
      return insertBlockOf(type as InsertableType, doc, masterDocId);
    };
    return () => {
      window.__insertBlock = undefined;
    };
  }, [client, runtime, masterDocId]);

  const onReconnect = () => {
    const provider = providerRef.current;
    if (provider === null) return;
    setConnected(false);
    provider.disconnect();
    void (async () => {
      try {
        await provider.connect();
        setConnected(true);
      } catch {
        setConnected(false);
      }
    })();
  };

  // The harness runs exactly two clients, so a remote peer is the other one.
  const peerLetter = client === "a" ? "b" : "a";

  // The consumer's publish stand (the harness's own storage — the package
  // owns no publish state): the room's state becomes the published
  // snapshot (the shared localStorage stand — the peer's pane reads the
  // same stand over its reload / re-read).
  const onPublish = () => {
    const doc = docRef.current;
    if (doc === null || runtime === null) return;
    const roomName = syncUrl.split("/").pop() ?? syncUrl;
    publishSnapshot(roomName, doc);
    setPublishedDoc(loadPublishedSnapshot(roomName));
    setPublishedSeq((seq) => seq + 1);
  };
  // The e2e's re-read path: the viewer's pane re-reads the room's published
  // stand after the editor's pane published (the shared localStorage stand
  // is the consumer's persistence — the panes are the same consumer).
  useEffect(() => {
    window.__reloadPublished = (letter) => {
      if (letter !== client) return true;
      const roomName = syncUrl.split("/").pop() ?? syncUrl;
      const snapshot = loadPublishedSnapshot(roomName);
      setPublishedDoc(snapshot);
      if (snapshot !== null) setPublishedSeq((seq) => seq + 1);
      return snapshot !== null;
    };
    return () => {
      window.__reloadPublished = undefined;
    };
  }, [client, syncUrl]);

  const TOGGLE_BTN = "h-auto gap-0 rounded-md px-2.5 py-0.5 text-[13px] font-normal shadow-none";
  const TAB_BTN = "h-auto gap-0 rounded px-2 py-0.5 text-xs font-normal shadow-none";
  const setDarkTrue = () => setDark(true);
  const setDarkFalse = () => setDark(false);
  const tabAt = (name: Parameters<typeof setTab>[0]) => () => setTab(name);

  const docAreaStyle: CSSProperties =
    view === "canvas"
      ? {
          // A definite height (not flex-derived: main is content-height, so a
          // flex:1 basis would collapse the canvas chain) for the editor's
          // flex chain — the canvas view is a viewport-like surface.
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 72px)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          overflow: "hidden",
          background: "var(--background)",
        }
      : // The page flow's doc area: a fixed width over the wide window —
        // the box hugs the page column (the 1060 px's column — the 900 px
        // block zone + the two 80 px gutter paddings — + the editor
        // card's 2x1 border + the box's 2x1 border + 2x8 padding = 1080
        // border-box): the blocks stand exactly the token's width over
        // the box. The narrow window stands the full width (the limit
        // never over-constrains). The CATALOG mode keeps the visual-golden
        // editor width (702: the doc area's content width the goldens
        // were captured at) — the width is 720 because the shipped
        // utility CSS puts box-sizing: border-box on every element (the
        // preflight in the shipped styles.css's base layer): 702 content
        // + 2x1 border + 2x8 padding.
        catalog
        ? { width: 720, maxWidth: "100%", border: "1px solid var(--border)", padding: 8, minHeight: 40 }
        : {
            width: 1080,
            maxWidth: "100%",
            alignSelf: "center",
            border: "1px solid var(--border)",
            padding: 8,
            minHeight: 40,
          };

  // main must stay content-height (a viewport-pinned fixed height makes
  // Chrome swallow the default Home/End caret moves inside the nested
  // contenteditable); the canvas view carries its own definite height for
  // the editor's flex chain.
  return (
    <main className="doc-main">
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
        <div data-testid={`doc-${client}`} ref={docAreaRef} style={docAreaStyle}>
          {role === "viewer" ? (
            // The viewer's security stand: the published snapshot is the
            // doc (the live document never reaches the reader's browser);
            // an absent snapshot renders the provider's not-published
            // placeholder. Each load yields a fresh doc instance, so the
            // key forces a provider remount on swap (the doc instance
            // must not change over a mounted provider).
            <EditorProvider
              key={publishedSeq}
              doc={publishedDoc ?? undefined}
              blobStore={blobStore}
              databaseBridge={databaseBridge}
              blockRenderers={BLOCK_RENDERERS}
              pdfPreview={PdfFirstPage}
              mentionProvider={mentionProvider}
              accessLevel="viewer"
            >
              <Editor view={view} />
            </EditorProvider>
          ) : (
            runtime !== null && (
              <EditorProvider
                doc={runtime.doc}
                provider={runtime.provider}
                blobStore={blobStore}
                databaseBridge={databaseBridge}
                blockRenderers={BLOCK_RENDERERS}
                syncEmbedResolver={syncEmbedResolver}
                pdfPreview={PdfFirstPage}
                mentionProvider={mentionProvider}
                presence={PRESENCE[client]}
                accessLevel={role}
                mode={mode}
                publishedDoc={publishedDoc}
              >
                <Editor view={view} />
                {/* The harness's sharing's control (the consumer-side UI over the hook — the
                     provider's context; the catalog's golden's fixture stands no control). */}
                {!catalog && <PresenceShareControl client={client} peerUserId={`user-${peerLetter}`} />}
              </EditorProvider>
            )
          )}
        </div>
      </section>
      {/* The system panel: status, chaos, and the live inspectors. */}
      <aside className="doc-aside">
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
          theme
          <Button
            type="button"
            variant={dark ? "default" : "outline"}
            size="sm"
            data-testid={`theme-${client}-dark`}
            aria-pressed={dark}
            className={TOGGLE_BTN}
            onClick={setDarkTrue}
          >
            dark
          </Button>
          <Button
            type="button"
            variant={!dark ? "default" : "outline"}
            size="sm"
            data-testid={`theme-${client}-light`}
            aria-pressed={!dark}
            className={TOGGLE_BTN}
            onClick={setDarkFalse}
          >
            light
          </Button>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", display: "flex", alignItems: "center", gap: 8 }}>
          <span data-testid={`status-${client}`}>{connected ? "connected" : "disconnected"}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid={`reconnect-${client}`}
            className="h-auto gap-0 px-2.5 py-0.5 text-[13px] font-normal"
            onClick={onReconnect}
          >
            reconnect
          </Button>
        </div>
        {role !== "viewer" && <ChaosBar syncUrl={syncUrl} />}
        {runtime !== null && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {TABS.map((name) => (
                <Button
                  key={name}
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`inspecttab-${client}-${name}`}
                  aria-pressed={tab === name}
                  className={cn(TAB_BTN, tab === name ? "bg-accent" : "bg-muted")}
                  onClick={tabAt(name)}
                >
                  {name}
                </Button>
              ))}
            </div>
            <div style={{ overflowY: "auto", maxHeight: "60vh", marginTop: 8 }}>
              <div style={{ display: tab === "json" ? undefined : "none" }}>
                <JsonInspector client={client} doc={runtime.doc} />
              </div>
              <div style={{ display: tab === "wire" ? undefined : "none" }}>
                <WireLog client={client} events={wire} />
              </div>
              <div style={{ display: tab === "presence" ? undefined : "none" }}>
                <PresencePanel client={client} peerLabel={peerLetter} mountAt={runtime.mountedAt} peers={presence} />
              </div>
              <div style={{ display: tab === "bridge" ? undefined : "none" }}>
                <BridgeInspector client={client} />
              </div>
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}

export { SyncPane };
