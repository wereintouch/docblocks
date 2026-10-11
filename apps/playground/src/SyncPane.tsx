import { Editor, EditorProvider } from "docblocks-react-ui";

import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { type Doc, type PresenceState, WsSyncProvider, attach, createDoc, presenceSelectionOf } from "docblocks-core";

/** Both panes open the same document, so edits and carets converge. */
const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

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

/** One remote peer as `<letter>:<blockId>:<offset>`; null when the peer has no caret. */
function presenceLine(letter: string, peer: PresenceState): string | null {
  const selection = peer.selection;
  if (selection === null) return null;
  if ("blockId" in selection) return `${letter}:${selection.blockId}:${selection.offset}`;
  if ("from" in selection) return `${letter}:${selection.from.blockId}:${selection.from.offset}`;
  return null;
}

/**
 * One sync client pane. Both panes create the same document and attach one
 * WsSyncProvider each, so edits and carets converge through the relay.
 * The doc area is the real editor (EditorProvider + Editor on the same
 * doc/provider instance); the pane's awareness still publishes a caret at
 * the end of the current block (deterministic for the presence specs).
 */
function SyncPane({ client, syncUrl }: { client: "a" | "b"; syncUrl: string }) {
  const docRef = useRef<Doc | null>(null);
  const providerRef = useRef<WsSyncProvider | null>(null);
  const docAreaRef = useRef<HTMLDivElement | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [connected, setConnected] = useState(false);
  const [blocks, setBlocks] = useState<PaneBlock[]>([]);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  /** This pane's awareness payload: a caret at the end of `blockId`. */
  const awarenessOf = (doc: Doc, blockId: string) => ({
    selection: presenceSelectionOf({
      kind: "text",
      from: { blockId, offset: doc.getTextLength(blockId) },
      to: null,
    }),
    updatedAt: Date.now(),
  });

  /** Push the caret (end of the current block) as this pane's awareness state. */
  const publishCaret = useCallback(() => {
    const doc = docRef.current;
    const provider = providerRef.current;
    const id = currentIdRef.current;
    if (doc === null || provider === null || id === null) return;
    provider.setAwareness(awarenessOf(doc, id));
  }, []);

  // One provider per mount. StrictMode's dev double-mount is safe: the first
  // instance's bytes are only buffered (the socket opens after cleanup) and
  // are dropped by destroy() before reaching the wire.
  useEffect(() => {
    const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT });
    const provider = new WsSyncProvider(syncUrl);
    const session = attach(doc, provider);
    docRef.current = doc;
    providerRef.current = provider;

    const refresh = () => {
      const nextBlocks = readBlocks(doc);
      setBlocks(nextBlocks);
      // Publish with the fresh snapshot, not the (pre-render) current ref:
      // doc changes must move the caret before React re-renders.
      const current = currentBlockOf(nextBlocks);
      if (current !== null) provider.setAwareness(awarenessOf(doc, current));
    };
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
    setRuntime({ doc, provider });

    return () => {
      unsubscribeDoc();
      unsubscribePresence();
      session.detach();
      provider.destroy();
      docRef.current = null;
      providerRef.current = null;
      setConnected(false);
      setBlocks([]);
      setPresence([]);
      setRuntime(null);
    };
  }, [syncUrl, publishCaret]);

  // The pane labels the rendered blocks for the e2e specs: a testid per
  // block and `data-current` on the pane's current block (the editor
  // renders the real blocks; the pane adds these harness attributes).
  useEffect(() => {
    const container = docAreaRef.current;
    if (container === null) return;
    const ids = new Set(blocks.map((block) => block.id));
    for (const el of Array.from(container.querySelectorAll<HTMLElement>("[data-block-id]"))) {
      const id = el.getAttribute("data-block-id");
      el.removeAttribute("data-testid");
      el.removeAttribute("data-current");
      if (id !== null && ids.has(id)) {
        el.setAttribute("data-testid", `block-${client}-${id}`);
        if (id === currentId) el.setAttribute("data-current", "true");
      }
    }
  }, [blocks, currentId, client]);

  // Caret publication on local selection changes too.
  useEffect(() => {
    document.addEventListener("selectionchange", publishCaret);
    return () => document.removeEventListener("selectionchange", publishCaret);
  }, [publishCaret]);

  const onEditorInput = (event: FormEvent<HTMLInputElement>) => {
    const doc = docRef.current;
    const id = currentIdRef.current;
    const data = (event.nativeEvent as InputEvent).data ?? "";
    if (doc === null || id === null || data === "") return;
    doc.insertText(id, doc.getTextLength(id), data);
    publishCaret();
  };

  const onAddBlock = () => {
    docRef.current?.insertBlock("paragraph"); // the onChange refresh makes it current
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
          <EditorProvider doc={runtime.doc} provider={runtime.provider}>
            <Editor />
          </EditorProvider>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          data-testid={`editor-${client}`}
          onInput={onEditorInput}
          onFocus={publishCaret}
          placeholder="type to append"
          style={{ flex: 1 }}
        />
        <button data-testid={`block-btn-${client}`} onClick={onAddBlock}>
          + block
        </button>
      </div>
      <div>
        presence:
        <div data-testid={`presence-${client}`} style={{ marginLeft: 8 }}>
          {presence.map((peer) => {
            const line = presenceLine(peerLetter, peer);
            return line === null ? null : <div key={peer.peerId}>{line}</div>;
          })}
        </div>
      </div>
    </main>
  );
}

export { SyncPane };
