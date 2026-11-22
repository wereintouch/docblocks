import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, buildSyncStep1Frame } from "../src/sync/ws-frames";
import { WsSyncProvider } from "../src/sync/ws-provider";
import type { WsLike } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";

/**
 * WsSyncProvider: join flow, buffering, kill/reconnect, token URL,
 * idempotency — against the in-memory standard relay.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/doc-1";

interface Client {
  provider: WsSyncProvider;
  doc: Doc;
}

const makeClient = (relay: WsRelay, opts: { url?: string; token?: string } = {}): Client => {
  const provider = new WsSyncProvider(opts.url ?? URL, {
    token: opts.token,
    webSocketImpl: (u) => relay.connect(u),
  });
  const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
  attach(doc, provider);
  return { provider, doc };
};

describe("join flow", () => {
  it("a fresh client receives the full state of a room with content", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "hello world");
    await relay.deliver();

    const b = makeClient(relay);
    await b.provider.connect();
    await relay.deliver();

    expect(b.doc.toJSON()).toEqual(a.doc.toJSON());
    expect(b.doc.getText(p)).toBe("hello world");
  });

  it("a reconnecting client syncs from its state vector and converges", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "base");
    await relay.deliver();

    await b.provider.connect();
    await relay.deliver();
    expect(b.doc.toJSON()).toEqual(a.doc.toJSON());

    a.doc.insertText(p, 4, "-one");
    await relay.deliver();
    b.provider.disconnect();
    a.doc.insertText(p, 0, "pre-");
    await relay.deliver();

    // B rejoins: its step1 carries the state it already saw (non-empty SV).
    await b.provider.connect();
    await relay.deliver();

    expect(b.doc.getText(p)).toBe("pre-base-one");
    expect(b.doc.toJSON()).toEqual(a.doc.toJSON());
    const svs = relay.step1s("/doc-1");
    expect(svs[svs.length - 1]!.size).toBeGreaterThan(0);
  });

  it("updates sent before connect are buffered and delivered after connect", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    a.doc.insertText(a.doc.insertBlock("paragraph"), 0, "from-a");
    await relay.deliver();

    const b = makeClient(relay);
    const pb = b.doc.insertBlock("paragraph"); // local edit before connect
    b.doc.insertText(pb, 0, "from-b");
    expect(a.doc.toJSON()).not.toEqual(b.doc.toJSON()); // not delivered yet

    await b.provider.connect();
    await relay.deliver();
    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    expect(a.doc.getText(pb)).toBe("from-b");
  });

  it("an update sent during the CONNECTING window is buffered, not thrown", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    a.doc.insertText(a.doc.insertBlock("paragraph"), 0, "base");
    await relay.deliver();

    // b's connect() creates the socket; the open event is deferred to a
    // microtask, so between connect() and the first await the socket stands
    // CONNECTING. A local edit in that window routes through sendUpdate —
    // the browser's WebSocket rejects a pre-open send (the provider must
    // buffer it instead of throwing). B loads A's settled state (no
    // concurrent init — the meta's title would race the bootstrap).
    const docB = loadDoc(a.doc.encode());
    const providerB = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    attach(docB, providerB);
    const connectP = providerB.connect();
    docB.setTitle("titled during connecting"); // must not throw
    expect(a.doc.meta.title).not.toBe("titled during connecting"); // not delivered yet

    await connectP;
    await relay.deliver();
    expect(a.doc.meta.title).toBe("titled during connecting");
    expect(a.doc.toJSON()).toEqual(docB.toJSON());
  });
});

describe("late attach", () => {
  it("a fresh doc attached after the handshake completes recovers the room state", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "hello world");
    await relay.deliver();

    // B: the provider connects and completes the handshake BEFORE the app
    // doc is attached (the late-attach stand).
    const bProvider = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    await bProvider.connect();
    await relay.deliver(); // the handshake stands done: bProvider's internal doc holds A's state
    const bDoc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    attach(bDoc, bProvider);
    await relay.deliver(); // settle the bootstrap exchange

    expect(bDoc.getText(p)).toBe("hello world");
    expect(bDoc.toJSON()).toEqual(a.doc.toJSON());
  });

  it("attach before connect stands the room state once the handshake completes", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "early");
    await relay.deliver();

    // B: the app doc is attached BEFORE the provider connects (the
    // bootstrap stands buffered until open).
    const bProvider = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    const bDoc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    attach(bDoc, bProvider);
    await bProvider.connect();
    await relay.deliver();

    expect(bDoc.getText(p)).toBe("early");
    expect(bDoc.toJSON()).toEqual(a.doc.toJSON());
  });

  it("a reattach after detach recovers the state missed while detached", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();

    const bProvider = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    const bDoc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    const session = attach(bDoc, bProvider);
    await bProvider.connect();
    await relay.deliver();

    // Detach: the doc is out of the loop while A writes.
    session.detach();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "missed while detached");
    await relay.deliver();

    // Reattach: the fresh session's subscription stands the accumulated
    // state (including everything the provider received while detached).
    attach(bDoc, bProvider);
    await relay.deliver();

    expect(bDoc.getText(p)).toBe("missed while detached");
    expect(bDoc.toJSON()).toEqual(a.doc.toJSON());
  });
});

describe("the step1's reply over a concatenated batch", () => {
  it("a received step1 + the trailing query frame stand both replies (no batch drop)", async () => {
    // A raw fake socket (no relay's server role): the open's handshake
    // stands fired explicitly, the incoming frames stand crafted.
    const sent: Uint8Array[] = [];
    const socket: WsLike = {
      send: (bytes) => {
        sent.push(bytes);
      },
      close: () => undefined,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
    };
    const provider = new WsSyncProvider(URL, { webSocketImpl: () => socket });
    const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    attach(doc, provider);
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "the state before the join");
    const attempt = provider.connect();
    socket.onopen?.({});
    await attempt;
    const baseline = sent.length; // the open's handshake frames (step1 + the buffered state)

    // One message: the peer's step1 (the fresh doc's empty state vector)
    // + the trailing query frame. The provider must reply with BOTH the
    // step2's diff and the awareness frame — a batch drop would send
    // nothing (the step1's payload stands re-parsed as a frame, the throw
    // drops the batch, the built reply with it).
    const peer = new Y.Doc();
    const step1 = buildSyncStep1Frame(peer);
    const queryEnc = encoding.createEncoder();
    encoding.writeVarUint(queryEnc, MESSAGE_QUERY_AWARENESS);
    const query = encoding.toUint8Array(queryEnc);
    const injected = new Uint8Array(step1.byteLength + query.byteLength);
    injected.set(step1, 0);
    injected.set(query, step1.byteLength);
    socket.onmessage?.({ data: injected });

    expect(sent.length).toBe(baseline + 1);
    const reply = decoding.createDecoder(sent[baseline]!);
    // The reply's first frame: the step2 with the peer's missing state.
    expect(decoding.readVarUint(reply)).toBe(MESSAGE_SYNC);
    expect(decoding.readVarUint(reply)).toBe(sync.messageYjsSyncStep2);
    const diff = decoding.readVarUint8Array(reply);
    expect(diff.byteLength).toBeGreaterThan(0);
    // The trailing frame's reply: the awareness frame.
    expect(decoding.readVarUint(reply)).toBe(MESSAGE_AWARENESS);
    // The reply's diff converges the peer: its raw doc holds the block.
    Y.applyUpdate(peer, diff);
    expect(peer.getMap("blocks").has(p)).toBe(true);
    provider.destroy();
  });
});
