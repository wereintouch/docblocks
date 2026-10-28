import { describe, expect, it } from "vitest";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

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

/** The last socket created by the relay (the newest provider connection). */
const lastSocket = (relay: WsRelay): FakeSocket => relay.sockets[relay.sockets.length - 1]!;

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

describe("lifecycle", () => {
  it("an unexpected close drops to disconnected; connect() again resyncs", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();
    const pa = a.doc.insertBlock("paragraph");
    a.doc.insertText(pa, 0, "synced");
    await relay.deliver();
    expect(b.doc.getText(pa)).toBe("synced");

    relay.killSocket(lastSocket(relay)); // B's connection dies
    const pb = b.doc.insertBlock("paragraph");
    b.doc.insertText(pb, 0, "offline edit"); // buffered
    a.doc.insertText(pa, 6, "-more");
    await relay.deliver();

    await b.provider.connect();
    await relay.deliver();

    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    expect(b.doc.getText(pa)).toBe("synced-more");
    expect(a.doc.getText(pb)).toBe("offline edit");
  });

  it("appends the token to the socket URL (and respects an existing query)", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay, { token: "abc def" });
    await a.provider.connect();
    expect(lastSocket(relay).url).toBe(`${URL}?token=abc%20def`);

    const b = makeClient(relay, { url: "ws://relay/doc-2?x=1", token: "t" });
    await b.provider.connect();
    expect(lastSocket(relay).url).toBe("ws://relay/doc-2?x=1&token=t");
  });

  it("connect is idempotent; disconnect and destroy are safe to repeat", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await a.provider.connect();
    expect(relay.sockets).toHaveLength(1); // one socket, no second open

    a.provider.disconnect();
    a.provider.disconnect();
    a.provider.destroy();
    a.provider.destroy();
    expect(lastSocket(relay).closed).toBe(true);
  });

  it("unknown frame types and malformed frames do not crash the provider", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "alive");

    relay.rawFrame(lastSocket(relay), new Uint8Array([99, 1, 2, 3])); // unknown type
    relay.rawFrame(lastSocket(relay), new Uint8Array([0, 2])); // truncated sync frame
    await relay.deliver();
    expect(a.doc.getText(p)).toBe("alive");

    const b = makeClient(relay);
    await b.provider.connect();
    await relay.deliver(); // still functional
    expect(b.doc.getText(p)).toBe("alive");
  });

  it("answers a query-awareness frame with the local awareness state", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    a.provider.setAwareness({ selection: { blockId: "b0", offset: 1 }, updatedAt: 42 });
    await relay.deliver();

    relay.queryAwareness(lastSocket(relay)); // the server asks B (last socket) for its state
    await relay.deliver();
    const seen: unknown[] = [];
    // The reply arrived at the relay; B (re)connects and picks up the states.
    const c = makeClient(relay);
    c.provider.onAwareness((peers) => seen.push(peers.length));
    await c.provider.connect();
    await relay.deliver();
    expect(seen[seen.length - 1]).toBeGreaterThan(0);
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
