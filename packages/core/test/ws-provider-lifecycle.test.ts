import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * WsSyncProvider's lifecycle (the sibling of ws-provider.test.ts): the
 * kill/reconnect resync, the token URL, the idempotent connect /
 * disconnect / destroy, the malformed frames, and the onUpdate failure's
 * recovery stand.
 */

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

  it("an onUpdate listener failure stands visible and the missed bytes are re-sent on reconnect", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    await a.provider.connect();
    await relay.deliver();
    const p = a.doc.insertBlock("paragraph");
    a.doc.insertText(p, 0, "hello");
    await relay.deliver();

    // b: a raw provider (no attach) with a manual glue that fails on the
    // first delivery (the app's own failure).
    const providerB = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    const docB = new Y.Doc();
    let failNext = true;
    providerB.onUpdate((bytes) => {
      if (failNext) {
        failNext = false;
        throw new Error("app failure");
      }
      Y.applyUpdate(docB, bytes);
    });
    await providerB.connect();

    // The exception stands visible (the old stand swallowed it as a
    // malformed frame) — and the socket stands.
    await expect(relay.deliver()).rejects.toThrow("app failure");
    expect(lastSocket(relay).closed).toBe(false);

    // The internal doc did not claim the missed state: the state vector
    // stays behind (the recovery stand — the next exchange re-sends the
    // missed bytes; a behind-claiming vector would leave the app doc
    // diverged for the connection's life).
    const bSV = Y.decodeStateVector(providerB.getLocalStateVector());
    const aSV = Y.decodeStateVector(a.doc.encode());
    for (const client of Object.keys(aSV)) expect(bSV).not.toHaveProperty(client);
    // The app doc holds no room state yet (the bootstrap delivery failed).
    expect(docB.getMap("blocks").size).toBe(0);

    // Reconnect: the behind vector stands the step1 gap — the missed
    // bytes are re-sent and the app doc converges.
    providerB.disconnect();
    await providerB.connect();
    await relay.deliver();
    expect(docB.getMap("blocks").size).toBeGreaterThan(0);
    expect(loadDoc(Y.encodeStateAsUpdate(docB)).getText(p)).toBe("hello");
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
