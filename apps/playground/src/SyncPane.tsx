import { type BlockRendererMap, EditorProvider, type EditorView } from "docblocks-react-ui";
import type { SyncEmbedResolver } from "docblocks-react-ui";
import { MermaidCodeRenderer } from "docblocks-react-ui/mermaid";
import { MotionEditor } from "docblocks-react-ui/motion";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { type Doc, type PresenceState, type SyncEmbedRef, WsSyncProvider, attach } from "docblocks-core";

import { ChaosBar } from "./ChaosBar";
import { createCanvasDoc } from "./canvas-seed";
import { DOC_ID, seedPaneDoc } from "./catalog";
import { blobResolver, insertBlockOf } from "./insert-blocks";
import type { InsertableType } from "./insert-blocks";
import { JsonInspector } from "./inspect/JsonInspector";
import { PresencePanel } from "./inspect/PresencePanel";
import { type WireEvent, WireLog } from "./inspect/WireLog";
import { CATALOG_MASTER_ID, createMasterRuntime, destroyMasterRuntime } from "./master";
import type { MasterRuntime } from "./master";
import { currentBlockOf, readBlocks } from "./pane-blocks";
import type { PaneBlock } from "./pane-blocks";
import { useBlockLabels } from "./useBlockLabels";

/** The wire log keeps the last N events. */
const WIRE_CAP = 50;

declare global {
  interface Window {
    /** Harness-only: the live docs of the mounted panes (per letter; null until the pane's effect ran); the e2e suite drives the command API through them. */
    __paneDocs?: { a: Doc | null; b: Doc | null };
    /** Harness-only: inserts a v1 block of `type` into the pane's doc with the harness attrs (see insert-blocks.ts) and returns its id (null if the pane is not mounted); the e2e suite's insert path in place of the removed insert controls. */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
  }
}

/**
 * The pane's renderer map (the demo of the `./mermaid` subpath): a
 * `code` block with `language: "mermaid"` renders the live diagram
 * preview, every other code block falls through to the built-in
 * rendering inside the renderer. Module-level: the provider reads the
 * map per render, so the reference must be stable.
 */
const BLOCK_RENDERERS: BlockRendererMap = { code: MermaidCodeRenderer };

/** The inspector tabs in the pane's system panel. */
const TABS = ["json", "wire", "presence"] as const;
type InspectTab = (typeof TABS)[number];

/** The pane's live doc + provider pair; null before the mount effect ran. */
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
 * The editor area always renders the animated editor from the
 * `docblocks-react-ui/motion` subpath (the consumer demo; the harness
 * helpers target the block wrappers the motion layer keeps);
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
}: {
  client: "a" | "b";
  syncUrl: string;
  catalog: boolean;
  canvas: boolean;
  cycle: boolean;
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
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);

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

    void provider
      .connect()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
    setRuntime({ doc, provider, master, mountedAt });

    return () => {
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
      setConnected(false);
      setBlocks([]);
      setPresence([]);
      setWire([]);
      setRuntime(null);
    };
  }, [syncUrl, catalog, canvas, cycle, masterDocId, client]);

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
    void provider
      .connect()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  };

  // The harness runs exactly two clients, so a remote peer is the other one.
  const peerLetter = client === "a" ? "b" : "a";

  const toggleStyle = (active: boolean): CSSProperties => ({
    padding: "2px 10px",
    fontSize: 13,
    border: "1px solid #d0d7de",
    borderRadius: 6,
    background: active ? "#0969da" : "#f6f8fa",
    color: active ? "#ffffff" : "#24292f",
    cursor: "pointer",
  });
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
          border: "1px solid #d0d7de",
          borderRadius: 8,
          overflow: "hidden",
          background: "#f6f8fa",
        }
      : // The page flow keeps the visual-golden editor width (702: the doc area's
        // content width the goldens were captured at).
        { width: 702, maxWidth: "100%", border: "1px solid #ccc", padding: 8, minHeight: 40 };

  // main must stay content-height (a viewport-pinned fixed height makes
  // Chrome swallow the default Home/End caret moves inside the nested
  // contenteditable); the canvas view carries its own definite height for
  // the editor's flex chain.
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        padding: 16,
        display: "flex",
        gap: 16,
        alignItems: "flex-start",
      }}
    >
      {/* The component under test: the page flow or the document canvas. */}
      <section style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18 }}>docblocks — {client}</h1>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              data-testid={`view-${client}-page`}
              aria-pressed={view === "page"}
              onClick={() => setView("page")}
              style={toggleStyle(view === "page")}
            >
              page
            </button>
            <button
              type="button"
              data-testid={`view-${client}-canvas`}
              aria-pressed={view === "canvas"}
              onClick={() => setView("canvas")}
              style={toggleStyle(view === "canvas")}
            >
              canvas
            </button>
          </div>
        </header>
        <div data-testid={`doc-${client}`} ref={docAreaRef} style={docAreaStyle}>
          {runtime !== null && (
            <EditorProvider
              doc={runtime.doc}
              provider={runtime.provider}
              blobResolver={blobResolver}
              blockRenderers={BLOCK_RENDERERS}
              syncEmbedResolver={syncEmbedResolver}
            >
              <MotionEditor view={view} />
            </EditorProvider>
          )}
        </div>
      </section>
      {/* The system panel: status, chaos, and the live inspectors. */}
      <aside
        style={{
          width: 420,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          borderLeft: "1px solid #d0d7de",
          paddingLeft: 16,
        }}
      >
        <div style={{ fontSize: 13, color: "#57606a", display: "flex", alignItems: "center", gap: 8 }}>
          <span data-testid={`status-${client}`}>{connected ? "connected" : "disconnected"}</span>
          <button data-testid={`reconnect-${client}`} onClick={onReconnect}>
            reconnect
          </button>
        </div>
        <ChaosBar syncUrl={syncUrl} />
        {runtime !== null && (
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {TABS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-testid={`inspecttab-${client}-${name}`}
                  aria-pressed={tab === name}
                  onClick={() => setTab(name)}
                  style={{
                    padding: "2px 8px",
                    fontSize: 12,
                    border: "1px solid #ccc",
                    background: tab === name ? "#dbeafe" : "#f6f8fa",
                  }}
                >
                  {name}
                </button>
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
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}

export { SyncPane };
