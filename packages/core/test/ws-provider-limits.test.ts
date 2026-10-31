import { describe, expect, it } from "vitest";
import * as sync from "y-protocols/sync";
import * as Y from "yjs";

import { createDoc } from "../src/core";
import { attach } from "../src/sync";
import {
  MESSAGE_SYNC,
  buildSyncUpdateFrame,
  extractUpdatePayload,
  parseFrameType,
  parseSyncType,
} from "../src/sync/ws-frames";
import { WsSyncProvider } from "../src/sync/ws-provider";
import type { WsLike } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";

/**
 * WsSyncProvider's client-side budgets: the offline buffer coalesces into one
 * flush frame (an offline edit storm is one frame, not one per edit), the
 * pending-byte overflow is observable, and an oversized incoming frame is
 * dropped whole.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/limits";

/** A manually driven socket: the test controls the open and captures sends. */
class ManualSocket implements WsLike {
  opened = false;
  closed = false;
  sent: Uint8Array[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: Uint8Array }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  send(data: Uint8Array): void {
    if (!this.opened) throw new Error("WebSocket is not open: ready state CONNECTING");
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.(undefined);
  }

  open(): void {
    this.opened = true;
    this.onopen?.(undefined);
  }
}

/** Distinct N updates (one Y.Doc each, a distinct client), so the coalesced
 *  flush must carry all of them. */
function nDistinctUpdates(n: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i += 1) {
    const doc = new Y.Doc();
    doc.getText("t").insert(0, "x");
    out.push(Y.encodeStateAsUpdate(doc));
  }
  return out;
}

/** The sync-update frames (type sync, syncType update) among a send list. */
function updateFrames(frames: Uint8Array[]): Uint8Array[] {
  return frames.filter((f) => {
    const type = parseFrameType(f);
    return type === MESSAGE_SYNC && parseSyncType(f) === sync.messageYjsUpdate;
  });
}

describe("the offline buffer's coalescing and budget", () => {
  it("coalesces an offline edit storm into ONE flush frame on the open", async () => {
    const socket = new ManualSocket();
    const provider = new WsSyncProvider(URL, { webSocketImpl: () => socket });

    const updates = nDistinctUpdates(50);
    let totalBytes = 0;
    for (const update of updates) {
      provider.sendUpdate(update); // pre-connect: buffered
      totalBytes += update.byteLength;
    }
    // Nothing is sent while the socket is not open; the byte count stands.
    expect(socket.sent.length).toBe(0);
    expect(provider.getPendingStats()).toEqual({ pendingBytes: totalBytes, overflow: false });

    const attempt = provider.connect();
    socket.open(); // the open fires onopen: the coalesced flush + the attempt's resolve
    await attempt;

    // The flush is a single coalesced sync-update frame (not 50).
    const flush = updateFrames(socket.sent);
    expect(flush.length).toBe(1);
    // The coalesced frame carries every buffered item (50 distinct clients).
    const target = new Y.Doc();
    Y.applyUpdate(target, extractUpdatePayload(flush[0]!)!);
    expect(target.getText("t").length).toBe(50);
    // The buffer is reset by the flush.
    expect(provider.getPendingStats()).toEqual({ pendingBytes: 0, overflow: false });
  });

  it("sets the overflow flag when the pending bytes pass maxPendingBytes, cleared on the flush", async () => {
    const socket = new ManualSocket();
    const provider = new WsSyncProvider(URL, {
      webSocketImpl: () => socket,
      maxPendingBytes: 100,
    });

    for (const update of nDistinctUpdates(50)) provider.sendUpdate(update); // > 100 bytes
    expect(provider.getPendingStats().overflow).toBe(true);

    const attempt = provider.connect();
    socket.open();
    await attempt;
    expect(provider.getPendingStats()).toEqual({ pendingBytes: 0, overflow: false });
  });
});

describe("the incoming frame budget", () => {
  it("drops an incoming sync-update frame over maxFrameBytes whole (not applied)", async () => {
    const relay = new WsRelay();
    const provider = new WsSyncProvider(URL, {
      webSocketImpl: (u) => relay.connect(u),
      maxFrameBytes: 64,
    });
    await provider.connect();
    await relay.deliver(); // the empty-room join stands (its frames are small)

    const before = Array.from(provider.getLocalStateVector());

    // A valid yjs update, large enough to pass the 64-byte client budget.
    const big = new Y.Doc();
    big.getText("t").insert(0, "z".repeat(500));
    const bigFrame = buildSyncUpdateFrame(Y.encodeStateAsUpdate(big));
    expect(bigFrame.byteLength).toBeGreaterThan(64);

    const socket = relay.sockets[relay.sockets.length - 1]!;
    relay.rawFrame(socket, bigFrame);
    await relay.deliver();

    // The oversized frame is dropped whole: the provider's state is unchanged.
    expect(Array.from(provider.getLocalStateVector())).toEqual(before);
  });

  it("applies an incoming frame within the budget (the gate is a ceiling, not a floor)", async () => {
    const relay = new WsRelay();
    const providerA = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u) });
    const providerB = new WsSyncProvider(URL, {
      webSocketImpl: (u) => relay.connect(u),
      maxFrameBytes: 4 * 1024 * 1024,
    });
    const docA = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    const docB = createDoc({ id: DOC_ID, createdAt: CREATED_AT });
    attach(docA, providerA);
    attach(docB, providerB);
    await providerA.connect();
    await providerB.connect();
    await relay.deliver();

    // A small edit from A stands a normal (within-budget) update to B.
    const p = docA.insertBlock("paragraph");
    docA.insertText(p, 0, "within budget");
    await relay.deliver();

    expect(docB.toJSON()).toEqual(docA.toJSON());
  });
});
