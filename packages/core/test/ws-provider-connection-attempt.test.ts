import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * WsSyncProvider's shared connection attempt (the sibling of
 * ws-provider.test.ts): the parallel connects' single attempt, the
 * pre-open cancellations, and the settled connect over an open socket.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/doc-1";

/** The last socket created by the relay (the newest provider connection). */
const lastSocket = (relay: WsRelay): FakeSocket => relay.sockets[relay.sockets.length - 1]!;

describe("the connection attempt", () => {
  const rawClient = (relay: WsRelay) => ({
    provider: new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) }),
    doc: createDoc({ id: DOC_ID, createdAt: CREATED_AT }),
  });

  it("parallel connects share one attempt and settle together over the open", async () => {
    const relay = new WsRelay();
    const { provider, doc } = rawClient(relay);
    attach(doc, provider);

    const p1 = provider.connect();
    const p2 = provider.connect();
    const p3 = provider.connect();
    expect(p2).toBe(p1); // the same shared attempt, not a lie over the socket's presence
    expect(p3).toBe(p1);

    await relay.deliver(); // the open microtask runs
    await Promise.all([p1, p2, p3]); // all settled together
    expect(relay.sockets).toHaveLength(1); // one socket, not three
  });

  it("a disconnect before the open rejects the shared attempt (no pending call remains)", async () => {
    const relay = new WsRelay();
    const { provider, doc } = rawClient(relay);
    attach(doc, provider);

    const p1 = provider.connect();
    const p2 = provider.connect();
    expect(p2).toBe(p1);
    provider.disconnect();

    await expect(p1).rejects.toThrow("was cancelled before the open");
    // The provider stands clean: a fresh connect starts a new attempt.
    const p3 = provider.connect();
    expect(p3).not.toBe(p1);
    await relay.deliver();
    await p3;
  });

  it("a server-side close before the open rejects the shared attempt", async () => {
    const relay = new WsRelay();
    const { provider, doc } = rawClient(relay);
    attach(doc, provider);

    const p = provider.connect();
    relay.killSocket(lastSocket(relay));

    await expect(p).rejects.toThrow("closed before the open");
    // Reconnect: a fresh attempt over a new socket.
    const p2 = provider.connect();
    expect(p2).not.toBe(p);
    await relay.deliver();
    await p2;
  });

  it("a connect over an open socket still stands resolved (the settled stand keeps)", async () => {
    const relay = new WsRelay();
    const { provider, doc } = rawClient(relay);
    attach(doc, provider);

    await provider.connect();
    await relay.deliver();
    const again = provider.connect(); // over the open socket
    await expect(again).resolves.toBeUndefined();
    expect(relay.sockets).toHaveLength(1);
  });
});
