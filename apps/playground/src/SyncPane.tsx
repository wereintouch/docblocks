import { Editor, EditorProvider } from "docblocks-react-ui";
import { MotionEditor } from "docblocks-react-ui/motion";

import { useEffect, useMemo, useRef, useState } from "react";

import { type Doc, type PresenceState, WsSyncProvider, attach, createDoc } from "docblocks-core";

import { MarkToolbar } from "./MarkToolbar";
import { INSERTABLE_TYPES, blobResolver, insertBlockOf } from "./insert-blocks";
import type { InsertableType } from "./insert-blocks";
import { JsonInspector } from "./inspect/JsonInspector";
import { PresencePanel } from "./inspect/PresencePanel";
import { type WireEvent, WireLog } from "./inspect/WireLog";

/** Both panes open the same document, so edits and carets converge. */
const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

/** The wire log keeps the last N events. */
const WIRE_CAP = 50;

/** The inspector tabs below the editor. */
const TABS = ["json", "wire", "presence"] as const;
type InspectTab = (typeof TABS)[number];

/** A rendered block: id, type, and flattened text. */
interface PaneBlock {
  id: string;
  type: string;
  text: string;
}

/** The pane's live doc + provider pair; null before the mount effect ran. */
interface Runtime {
  doc: Doc;
  provider: WsSyncProvider;
  /** Unix ms of the runtime mount; the wire/presence stamps are relative to it. */
  mountedAt: number;
}

/** The non-root blocks in reading order, as a plain snapshot. */
function readBlocks(doc: Doc): PaneBlock[] {
  const json = doc.toJSON();
  const root = json.blocks[json.id];
  const ids = root !== undefined && root.type === "root" ? root.children : [];
  return ids.map((id) => {
    const block = json.blocks[id];
    return { id, type: block === undefined ? "missing" : block.type, text: doc.getText(id) };
  });
}

/** The pane's current block: the last paragraph in reading order. */
function currentBlockOf(blocks: PaneBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    if (block.type === "paragraph") return block.id;
  }
  return null;
}

/**
 * One sync client pane. Both panes create the same document and attach one
 * WsSyncProvider each, so edits and carets converge through the relay.
 * The doc area is the real editor (EditorProvider + Editor on the same
 * doc/provider instance): typing is the real editor, the pane's awareness
 * is published by the provider from the real DOM selection, and the pane
 * renders the remote peers and drives the editor with doc commands.
 * `motion` renders the animated editor from the `docblocks-react-ui/motion`
 * subpath instead of the base `Editor` (the harness attributes and helpers
 * target the block wrappers, which the motion layer keeps).
 *
 * Below the editor the pane shows its inspectors (JSON / Wire / Presence
 * tabs): all three stay mounted and the tabs only toggle visibility — the
 * subscriptions live in the pane's runtime effect, so a hidden inspector
 * keeps updating and its testid stays queryable.
 */
function SyncPane({ client, syncUrl, motion }: { client: "a" | "b"; syncUrl: string; motion: boolean }) {
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
  const [insertType, setInsertType] = useState<InsertableType>("paragraph");
  const [tab, setTab] = useState<InspectTab>("json");
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);

  // One provider per mount. StrictMode's dev double-mount is safe: the first
  // instance's bytes are only buffered (the socket opens after cleanup) and
  // are dropped by destroy() before reaching the wire.
  useEffect(() => {
    const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT });
    const provider = new WsSyncProvider(syncUrl);
    const mountedAt = Date.now();

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
    // The provider reports remote peers only (its own awareness state is
    // excluded by client id), so the list needs no self-filtering.
    const unsubscribePresence = provider.onAwareness((peers) => setPresence(peers));

    // The pane's own first block; both clients may create one — the root
    // order converges, and the caret follows the shared last paragraph.
    doc.insertBlock("paragraph");

    void provider
      .connect()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
    setRuntime({ doc, provider, mountedAt });

    return () => {
      unsubscribeDoc();
      unsubscribePresence();
      unsubscribeWire();
      session.detach();
      provider.destroy();
      docRef.current = null;
      providerRef.current = null;
      setConnected(false);
      setBlocks([]);
      setPresence([]);
      setWire([]);
      setRuntime(null);
    };
  }, [syncUrl]);

  // The pane labels the rendered blocks for the e2e specs: a testid per
  // block and `data-current` on the pane's current block (the editor
  // renders the real blocks; the pane adds these harness attributes).
  // Text-editable blocks carry the id on the wrapper and the inner
  // editable — only the wrapper is labeled.
  useEffect(() => {
    const container = docAreaRef.current;
    if (container === null) return;
    const ids = new Set(blocks.map((block) => block.id));
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"))) {
      if (el.getAttribute("data-slot") === "docblocks/block-content") continue;
      const id = el.getAttribute("data-block-id");
      el.removeAttribute("data-testid");
      el.removeAttribute("data-current");
      if (id !== null && ids.has(id)) {
        el.setAttribute("data-testid", `block-${client}-${id}`);
        if (id === currentId) el.setAttribute("data-current", "true");
      }
    }
  }, [blocks, currentId, client]);

  const onAddBlock = () => {
    const doc = docRef.current;
    if (doc === null) return;
    doc.insertBlock("paragraph");
  };

  /** Insert the selected v1 type at the root (harness attrs; see insert-blocks.ts). */
  const onInsertBlock = () => {
    const doc = docRef.current;
    if (doc === null) return;
    insertBlockOf(insertType, doc);
  };

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

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 24, maxWidth: 720 }}>
      <h1>docblocks sync — {client}</h1>
      <p>
        status: <span data-testid={`status-${client}`}>{connected ? "connected" : "disconnected"}</span>{" "}
        <button data-testid={`reconnect-${client}`} onClick={onReconnect}>
          reconnect
        </button>
      </p>
      <div
        data-testid={`doc-${client}`}
        ref={docAreaRef}
        style={{ border: "1px solid #ccc", padding: 8, minHeight: 40 }}
      >
        {runtime !== null && (
          <EditorProvider doc={runtime.doc} provider={runtime.provider} blobResolver={blobResolver}>
            <MarkToolbar client={client} />
            {motion ? <MotionEditor /> : <Editor />}
          </EditorProvider>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button data-testid={`block-btn-${client}`} onClick={onAddBlock}>
          + block
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <select
          data-testid={`block-type-select-${client}`}
          value={insertType}
          onChange={(event) => setInsertType(event.target.value as InsertableType)}
        >
          {INSERTABLE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button data-testid={`block-type-btn-${client}`} onClick={onInsertBlock}>
          + insert
        </button>
      </div>
      {runtime !== null && (
        <div style={{ marginTop: 8 }}>
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
      )}
    </main>
  );
}

export { SyncPane };
