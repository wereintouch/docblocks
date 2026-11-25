import { useEffect, useRef, useState } from "react";

import { type Doc, type PresenceState, WsSyncProvider, attach } from "docblocks-core";

import { createCanvasDoc } from "./canvas-seed";
import { DOC_ID, seedPaneDoc } from "./catalog";
import { databaseBridge } from "./database-seed";
import { createHeavyDoc } from "./heavy-seed";
import { type InsertableType, insertBlockOf } from "./insert-blocks";
import { type WireEvent } from "./inspect/WireLog";
import { createLongDoc } from "./longdoc-seed";
import { type MasterRuntime, createMasterRuntime, destroyMasterRuntime } from "./master";
import { type PaneBlock, readBlocks } from "./pane-blocks";

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
    /** Harness-only: inserts a v1 block of `type` into the pane's doc with the harness attrs (the block attrs the insert path applies by type) and returns its id (null if the pane is not mounted); the e2e suite's insert path in place of the removed insert controls. */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
    /** Harness-only: re-reads the room's published snapshot from the shared stand (the publish.ts's localStorage) and applies it to the pane's published stand (the e2e's A/B flow: the editor's pane publishes, the viewer's pane re-reads); true when a stand was applied. */
    __reloadPublished?: (client: "a" | "b") => boolean;
    /** Harness-only: the blob store's `get` calls in order (the lazy loading's e2e probe — which file ids resolved); the array stands from module load. */
    __blobGets?: string[];
  }
}

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

interface SyncRuntimeParams {
  client: "a" | "b";
  syncUrl: string;
  catalog: boolean;
  canvas: boolean;
  heavy: boolean;
  /** The long-document seed's image count (0 when the mode stands off). */
  longdoc: number;
  cycle: boolean;
  role: "editor" | "viewer";
  masterDocId: string;
}

/**
 * The pane's sync runtime: the doc + WsSyncProvider + master pair over the
 * relay, the wire log's observation, the plain room's starter paragraph,
 * and the harness' window stands (`__paneDocs` / `__bridge` /
 * `__masterDocs` / `__insertBlock`). One provider per mount; StrictMode's
 * dev double-mount is safe: the first instance's bytes are only buffered
 * (the socket opens after cleanup) and are dropped by destroy() before
 * reaching the wire.
 */
function useSyncRuntime({
  client,
  syncUrl,
  catalog,
  canvas,
  heavy,
  longdoc,
  cycle,
  role,
  masterDocId,
}: SyncRuntimeParams) {
  const docRef = useRef<Doc | null>(null);
  const providerRef = useRef<WsSyncProvider | null>(null);
  /** The wire log's per-pane event counter (capped list, unique key). */
  const wireSeq = useRef(0);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [connected, setConnected] = useState(false);
  const [blocks, setBlocks] = useState<PaneBlock[]>([]);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [wire, setWire] = useState<WireEvent[]>([]);

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
    const doc =
      longdoc > 0
        ? createLongDoc(client === "a", longdoc)
        : heavy
          ? createHeavyDoc(client === "a")
          : canvas
            ? createCanvasDoc(client === "a")
            : seedPaneDoc(catalog);
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
    if (client === "a" && !catalog && !canvas && !heavy && longdoc === 0) {
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
  }, [syncUrl, catalog, canvas, heavy, longdoc, cycle, masterDocId, client, role]);

  /**
   * The e2e insert path: inserts the v1 type into this pane's doc with the
   * harness attrs (the block attrs the insert path applies by type) and
   * returns the block id.
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

  return { blocks, connected, onReconnect, presence, runtime, wire };
}

export { useSyncRuntime };
export type { Runtime };
