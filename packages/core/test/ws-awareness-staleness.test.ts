import { describe, expect, it, vi } from "vitest";

/**
 * WsSyncProvider presence staleness: the built-in 30 s TTL of the standard
 * y-protocols awareness channel, driven by fake timers.
 *
 * This file deliberately has no static imports of the provider graph:
 * lib0's getUnixTime (y-protocols' staleness clock) captures Date.now at
 * module load, and node_modules modules are cached natively, so the graph
 * must be first evaluated inside the test, under fake timers, or the clock
 * never ages.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/doc-1";

const caret = (blockId: string, offset: number) => ({ blockId, offset });

describe("staleness", () => {
  it("a peer not renewing for 30 s is dropped (standard TTL, fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const { createDoc } = await import("../src/core");
      const { attach } = await import("../src/sync");
      const { WsSyncProvider } = await import("../src/sync/ws-provider");
      const { WsRelay } = await import("./ws-relay");

      const relay = new WsRelay();
      const make = () => {
        const provider = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
        const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
        attach(doc, provider);
        return { provider, socket: () => relay.sockets[relay.sockets.length - 1]! };
      };
      const a = make();
      const b = make();
      await a.provider.connect();
      await b.provider.connect();
      await relay.deliver();

      const seenByB: unknown[][] = [];
      b.provider.onAwareness((peers) => seenByB.push([...peers]));
      a.provider.setAwareness({ selection: caret("b0", 1), updatedAt: 1000 });
      await relay.deliver();
      expect(seenByB[seenByB.length - 1]!).toHaveLength(1);

      // A's renewal broadcasts can no longer reach B: B ages out the peer.
      relay.mute(b.socket());
      vi.advanceTimersByTime(33_000); // 11 x 3 s internal checks, > 30 s TTL
      await relay.deliver();
      expect(seenByB[seenByB.length - 1]!).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
