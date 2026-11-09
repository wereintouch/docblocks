import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import type { PresenceState } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * The sharing-contract presence extras (userId / name / selections /
 * seq) cross the awareness channel: the ws-provider pass-through mapper
 * delivers them on `PresenceState`, and malformed or legacy fields are
 * dropped defensively (a legacy frame stands its pre-sharing shape).
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://localhost/doc-1";

interface Client {
  provider: WsSyncProvider;
  doc: Doc;
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

const lastSeen = async (relay: WsRelay, seen: PresenceState[][]): Promise<PresenceState[]> => {
  await relay.deliver();
  return seen[seen.length - 1]!;
};

describe("the sharing extras' pass-through", () => {
  it("a sharing frame's extras arrive on the recipient's PresenceState", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({
      selection: caret("b0", 3),
      selections: ["cipher-for-b", "cipher-for-c"],
      userId: "u-alice",
      name: "Alice",
      seq: 42,
      updatedAt: 1234,
    });

    const last = await lastSeen(relay, seenByB);
    expect(last).toHaveLength(1);
    expect(last[0]!.selection).toEqual(caret("b0", 3));
    expect(last[0]!.selections).toEqual(["cipher-for-b", "cipher-for-c"]);
    expect(last[0]!.userId).toBe("u-alice");
    expect(last[0]!.name).toBe("Alice");
    expect(last[0]!.seq).toBe(42);
    expect(last[0]!.updatedAt).toBe(1234);
  });

  it("an identity-only frame (sharing off) arrives without a selection", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({ userId: "u-alice", name: "Alice", updatedAt: 1234 });

    const last = await lastSeen(relay, seenByB);
    expect(last[0]!.selection).toBeNull();
    expect(last[0]!.userId).toBe("u-alice");
    expect("selections" in last[0]!).toBe(false);
  });

  it("malformed extras are dropped defensively (the legacy shape survives)", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({
      selection: caret("b0", 1),
      userId: 42,
      name: null,
      selections: ["ok", 7],
      seq: "x",
      updatedAt: 1000,
    });

    const last = await lastSeen(relay, seenByB);
    expect(last[0]!.selection).toEqual(caret("b0", 1));
    expect("userId" in last[0]!).toBe(false);
    expect("name" in last[0]!).toBe(false);
    expect("selections" in last[0]!).toBe(false); // a non-string entry voids the whole array
    expect("seq" in last[0]!).toBe(false);
  });

  it("a legacy frame (selection + updatedAt only) stands its pre-sharing shape", async () => {
    const relay = new WsRelay();
    const a = makeClient(relay);
    const b = makeClient(relay);
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();

    const seenByB: PresenceState[][] = [];
    b.provider.onAwareness((peers) => seenByB.push([...peers]));
    a.provider.setAwareness({ selection: caret("b0", 9), updatedAt: 777 });

    const last = await lastSeen(relay, seenByB);
    expect(last[0]!.selection).toEqual(caret("b0", 9));
    expect("userId" in last[0]!).toBe(false);
    expect("name" in last[0]!).toBe(false);
    expect("selections" in last[0]!).toBe(false);
    expect("seq" in last[0]!).toBe(false);
  });
});
