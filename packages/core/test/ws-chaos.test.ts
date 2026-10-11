import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * Chaos scenarios beyond ws-convergence: kill + reconnect of the active
 * side under a divergent window, an update frame dropped in flight (healed
 * by a resync), and the combined duplicate + shuffle delivery mode.
 * (Plain, duplicate-alone, shuffle-alone, and the B-side kill are pinned in
 * ws-convergence.test.ts.) Losses over a live socket are modeled as frame
 * drops or kill + reconnect — the WebSocket contract is reliable delivery.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const URL = "ws://relay/doc-1";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** Per-side commands, applied in list order (offsets depend on predecessors). */
type Snapshot = ReturnType<Doc["toJSON"]>;
const OPS: Array<(doc: Doc, p: string) => void> = [
  (d, p) => d.insertText(p, d.getText(p).length, "alpha "),
  (d, p) => d.setMark(p, 0, 5, { type: "bold" }),
  (d, p) => d.insertText(p, d.getText(p).length, "beta"),
  (d, p) => d.setMark(p, 6, 10, { type: "italic" }),
  (d, p) => d.insertText(p, d.getText(p).length, " gamma"),
  (d, p) => d.insertText(p, 2, "x"),
];

interface Side {
  provider: WsSyncProvider;
  doc: Doc;
  socket: () => FakeSocket;
  paragraph: string;
}

const makeSide = (relay: WsRelay, idPrefix: string): Side => {
  let socket: FakeSocket | undefined;
  const provider = new WsSyncProvider(URL, { webSocketImpl: (u) => (socket = relay.connect(u))! });
  const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT, generateId: makeIds(idPrefix) });
  attach(doc, provider);
  return { provider, doc, socket: () => socket!, paragraph: "" };
};

describe("kill + reconnect of the active side", () => {
  it("A dies mid-session; both sides keep diverging; A rejoins and both converge", async () => {
    const relay = new WsRelay();
    const a = makeSide(relay, "a");
    const b = makeSide(relay, "b");
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();
    a.paragraph = a.doc.insertBlock("paragraph");
    a.doc.insertText(a.paragraph, 0, "a-base");
    await relay.deliver();
    b.paragraph = b.doc.insertBlock("paragraph");
    b.doc.insertText(b.paragraph, 0, "b-base");
    await relay.deliver();

    // Divergent window: an edit on each side, not yet delivered.
    a.doc.insertText(a.paragraph, a.doc.getText(a.paragraph).length, "-a1");
    b.doc.insertText(b.paragraph, b.doc.getText(b.paragraph).length, "-b1");

    // A's connection dies; both sides keep editing behind the partition.
    relay.killSocket(a.socket());
    a.doc.insertText(a.paragraph, a.doc.getText(a.paragraph).length, "-a2"); // A: offline, buffered
    b.doc.insertText(b.paragraph, b.doc.getText(b.paragraph).length, "-b2"); // B: reaches no one

    // A rejoins: the step1/step2 exchange resyncs after the unexpected close.
    await a.provider.connect();
    await relay.deliver();

    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    // Both sides' divergent edits are present on both docs.
    expect(a.doc.getText(a.paragraph)).toBe("a-base-a1-a2");
    expect(b.doc.getText(a.paragraph)).toBe("a-base-a1-a2");
    expect(a.doc.getText(b.paragraph)).toBe("b-base-b1-b2");
    expect(b.doc.getText(b.paragraph)).toBe("b-base-b1-b2");
  });
});

describe("dropped frame recovery", () => {
  it("an update frame lost in flight is restored when the missing peer resyncs", async () => {
    const relay = new WsRelay();
    const a = makeSide(relay, "a");
    const b = makeSide(relay, "b");
    await a.provider.connect();
    await b.provider.connect();
    await relay.deliver();
    a.paragraph = a.doc.insertBlock("paragraph");
    a.doc.insertText(a.paragraph, 0, "a-text");
    await relay.deliver();
    b.paragraph = b.doc.insertBlock("paragraph");
    b.doc.insertText(b.paragraph, 0, "b-text");
    await relay.deliver();

    // B's downlink is partitioned: A's next update is lost in flight.
    relay.mute(b.socket());
    a.doc.insertText(a.paragraph, a.doc.getText(a.paragraph).length, "-lost");
    b.doc.insertText(b.paragraph, b.doc.getText(b.paragraph).length, "-kept"); // B can still send
    await relay.deliver();
    expect(b.doc.getText(a.paragraph)).toBe("a-text"); // B missed the lost frame
    expect(a.doc.getText(b.paragraph)).toBe("b-text-kept");

    // The missing peer resyncs: a fresh step1/step2 exchange over a new
    // connection (the new socket is not muted).
    b.provider.disconnect();
    await b.provider.connect();
    await relay.deliver();

    expect(a.doc.toJSON()).toEqual(b.doc.toJSON());
    expect(b.doc.getText(a.paragraph)).toBe("a-text-lost");
    expect(a.doc.getText(b.paragraph)).toBe("b-text-kept");
  });
});

describe("combined duplicate + shuffle delivery", () => {
  it("a multi-op interleaved session converges to the plain state", async () => {
    const run = async (chaos: "plain" | "both"): Promise<[Snapshot, Snapshot]> => {
      const relay = new WsRelay(42);
      if (chaos === "both") {
        relay.setDuplicateAll(true);
        relay.setShuffleAll(true);
      }
      const a = makeSide(relay, "a");
      const b = makeSide(relay, "b");
      await a.provider.connect();
      await b.provider.connect();
      await relay.deliver();

      // Block creation is serialized so both peers agree on root order; the
      // OPS sequence stays fully interleaved.
      a.paragraph = a.doc.insertBlock("paragraph");
      await relay.deliver();
      b.paragraph = b.doc.insertBlock("paragraph");
      await relay.deliver();
      for (const op of OPS) {
        op(a.doc, a.paragraph);
        op(b.doc, b.paragraph);
        await relay.deliver();
      }
      return [a.doc.toJSON(), b.doc.toJSON()];
    };

    const [plainA, plainB] = await run("plain");
    const [chaosA, chaosB] = await run("both");
    expect(chaosA).toEqual(chaosB);
    expect(chaosA).toEqual(plainA);
    expect(chaosB).toEqual(plainB);
  });
});
