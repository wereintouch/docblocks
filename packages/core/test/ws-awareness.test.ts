import * as encoding from "lib0/encoding";
import { describe, expect, it } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import type { PresenceState } from "../src/sync/provider";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * WsSyncProvider presence: the standard y-protocols awareness channel —
 * round-trip, self-exclusion, clock last-write-wins, and leave-on-close.
 * (The 30 s staleness TTL lives in ws-awareness-staleness.test.ts: its
 * fake-clock setup requires a clean module graph, which a dedicated file
 * provides.)
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/doc-1";

interface Client {
  provider: WsSyncProvider;
  doc: Doc;
  /** The fake socket the provider connected through (valid after connect()). */
  socket: () => FakeSocket;
}

const makeClient = (relay: WsRelay): Client => {
  let socket: FakeSocket | undefined;
  const provider = new WsSyncProvider(URL, {
    webSocketImpl: (u) => {
      socket = relay.connect(u);
      return socket;
    },
  });
  const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
  attach(doc, provider);
  return { provider, doc, socket: () => socket! };
};

const caret = (blockId: string, offset: number) => ({ blockId, offset });

describe("presence round-trip", () => {
  it("a late subscriber receives the current peer list at subscribe time", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    a.provider.setAwareness({ selection: caret("b0", 3), updatedAt: 1234 });
    await relay.deliver();

    // B subscribes only now — the current list must arrive synchronously.
    let delivered: PresenceState[] | null = null;
    b.provider.onAwareness((peers) => (delivered = [...peers]));
    expect(delivered).not.toBeNull();
    expect(delivered![0]!.selection).toEqual(caret("b0", 3));
  });
  it("a peer's state arrives mapped to PresenceState; each side sees only the other", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({ selection: caret("b0", 3), updatedAt: 1234 });
    await relay.deliver();

    const last = seenByB[seenByB.length - 1]!;
    expect(last).toHaveLength(1); // B's own empty state never appears for B
    expect(last[0]!.selection).toEqual(caret("b0", 3));
    expect(last[0]!.updatedAt).toBe(1234);
    expect(/^\d+$/.test(last[0]!.peerId)).toBe(true);

    const seenByA: PresenceState[][] = [];
    a.provider.onAwareness((peers) => seenByA.push([...peers]));
    b.provider.setAwareness({ selection: caret("b0", 7), updatedAt: 5678 });
    await relay.deliver();

    const lastA = seenByA[seenByA.length - 1]!;
    expect(lastA).toHaveLength(1); // A never sees itself
    expect(lastA[0]!.selection).toEqual(caret("b0", 7));
    expect(lastA[0]!.peerId).not.toBe(last[0]!.peerId); // distinct client IDs
  });

  it("the newer state wins even when the older one is delivered later", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({ selection: caret("b0", 1), updatedAt: 1000 });
    a.provider.setAwareness({ selection: caret("b0", 2), updatedAt: 2000 });

    relay.setShuffleAll(true);
    await relay.deliver();
    relay.setShuffleAll(false);

    const last = seenByB[seenByB.length - 1]!;
    expect(last[0]!.selection).toEqual(caret("b0", 2)); // clock 2 beats clock 1
    expect(last[0]!.updatedAt).toBe(2000);
  });

  it("a malformed remote selection is delivered as null, not verbatim", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));

    // A foreign peer pushes a state whose selection is none of the wire forms.
    const intruder = new Y.Doc();
    const intruderAwareness = new Awareness(intruder);
    intruderAwareness.setLocalState({ selection: { bogus: true } });
    const payload = encodeAwarenessUpdate(intruderAwareness, [intruder.clientID]);
    intruderAwareness.destroy();
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1); // awareness frame
    encoding.writeVarUint8Array(encoder, payload);
    relay.rawFrame(b.socket(), encoding.toUint8Array(encoder));
    await relay.deliver();

    const last = seenByB[seenByB.length - 1]!;
    const intruderPeer = last.find((peer) => peer.peerId === String(intruder.clientID));
    expect(intruderPeer).toBeDefined();
    expect(intruderPeer!.selection).toBeNull();
  });

  it("a disconnected peer disappears from the other's presence list", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({ selection: caret("b0", 1), updatedAt: 1000 });
    await relay.deliver();
    expect(seenByB[seenByB.length - 1]!.length).toBe(1);

    a.provider.disconnect();
    await relay.deliver();
    expect(seenByB[seenByB.length - 1]!).toEqual([]);
  });
});
