import { Editor, EditorProvider } from "docblocks-react-ui";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { type Doc, type PresenceState, WsSyncProvider, attach, createDoc } from "docblocks-core";

import { INSERTABLE_TYPES, blobResolver, insertBlockOf } from "./insert-blocks";
import type { InsertableType } from "./insert-blocks";

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
 * Place the real DOM caret at the end of a block — what a keystroke in
 * the editor would leave behind — so the editor owns the selection and
 * the provider's awareness reflects it. Runs in a frame after the store
 * applied the change and the text DOM caught up. Harness-only: the page
 * hosts exactly one pane per doc id, so a document-global query is safe.
 */
function caretAtEndOf(blockId: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (el === null) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    if (selection === null) return;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

/**
 * Focus a fresh (empty) block and place the caret at its start, so the
 * editor owns the selection for the new block. Harness-only: the page
 * hosts exactly one pane per doc id, so a document-global query is safe.
 */
function focusBlockStart(blockId: string): void {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
    if (el === null) return;
    el.focus();
    // An empty block has no text node to anchor on: set the range
    // explicitly at the element start.
    const range = document.createRange();
    range.setStart(el, 0);
    range.collapse(true);
    const selection = window.getSelection();
    if (selection === null) return;
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

/**
 * One sync client pane. Both panes create the same document and attach one
 * WsSyncProvider each, so edits and carets converge through the relay.
 * The doc area is the real editor (EditorProvider + Editor on the same
 * doc/provider instance): the pane's awareness is published by the
 * provider from the real DOM selection, the pane only renders the remote
 * peers and drives the editor with doc commands.
 */
function SyncPane({ client, syncUrl }: { client: "a" | "b"; syncUrl: string }) {
  const docRef = useRef<Doc | null>(null);
  const providerRef = useRef<WsSyncProvider | null>(null);
  const docAreaRef = useRef<HTMLDivElement | null>(null);
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [connected, setConnected] = useState(false);
  const [blocks, setBlocks] = useState<PaneBlock[]>([]);
  const [presence, setPresence] = useState<PresenceState[]>([]);
  const [insertType, setInsertType] = useState<InsertableType>("paragraph");
  const currentId = useMemo(() => currentBlockOf(blocks), [blocks]);
  const currentIdRef = useRef<string | null>(null);
  currentIdRef.current = currentId;

  // One provider per mount. StrictMode's dev double-mount is safe: the first
  // instance's bytes are only buffered (the socket opens after cleanup) and
  // are dropped by destroy() before reaching the wire.
  useEffect(() => {
    const doc = createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT });
    const provider = new WsSyncProvider(syncUrl);
    const session = attach(doc, provider);
    docRef.current = doc;
    providerRef.current = provider;

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
  }, [syncUrl]);

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

  const onEditorInput = (event: FormEvent<HTMLInputElement>) => {
    const doc = docRef.current;
    const id = currentIdRef.current;
    const data = (event.nativeEvent as InputEvent).data ?? "";
    if (doc === null || id === null || data === "") return;
    doc.insertText(id, doc.getTextLength(id), data);
    caretAtEndOf(id);
  };

  const onAddBlock = () => {
    const doc = docRef.current;
    if (doc === null) return;
    focusBlockStart(doc.insertBlock("paragraph")); // the onChange refresh makes it current
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
            <Editor />
          </EditorProvider>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <input
          data-testid={`editor-${client}`}
          onInput={onEditorInput}
          placeholder="type to append"
          style={{ flex: 1 }}
        />
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
