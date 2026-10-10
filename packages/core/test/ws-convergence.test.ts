import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";
import type { FakeSocket } from "./ws-relay";

/**
 * Transport-level convergence (api-v1 test criterion: random order with
 * losses and duplicates): two attached docs through the relay, an
 * interleaved command sequence, identical final state under frame
 * duplication, shuffled delivery, and kill+reconnect. (Losses over a live
 * socket are impossible — the WebSocket contract is reliable delivery;
 * kill+reconnect is the transport-level loss case, healed by the step1/
 * step2 resync.)
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

/** Run the full interleaved sequence under one chaos mode; return both docs' snapshots. */
const runScenario = async (chaos: "none" | "duplicate" | "shuffle" | "kill"): Promise<[Snapshot, Snapshot]> => {
  const relay = new WsRelay(42);
  if (chaos === "duplicate") relay.setDuplicateAll(true);
  if (chaos === "shuffle") relay.setShuffleAll(true);

  const make = (idPrefix: string): Side => {
    let socket: FakeSocket | undefined;
    const provider = new WsSyncProvider(URL, { webSocketImpl: (u) => (socket = relay.connect(u))! });
    const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT, generateId: makeIds(idPrefix) });
    attach(doc, provider);
    return { provider, doc, socket: () => socket!, paragraph: "" };
  };
  const a = make("a");
  const b = make("b");
  await a.provider.connect();
  await b.provider.connect();
  await relay.deliver();

  // Block creation is serialized so both peers agree on root order
  // (concurrent inserts at the same position tie-break by client ID,
  // which is random per run); the OPS sequence stays fully interleaved.
  a.paragraph = a.doc.insertBlock("paragraph");
  await relay.deliver();
  b.paragraph = b.doc.insertBlock("paragraph");
  await relay.deliver();

  for (let i = 0; i < OPS.length; i++) {
    if (chaos === "kill") {
      if (i === 3) relay.killSocket(b.socket()); // B drops out; its ops buffer
      if (i === 5) {
        await b.provider.connect(); // rejoin: step1 resync + buffered ops flush
        await relay.deliver();
      }
    }
    OPS[i]!(a.doc, a.paragraph);
    OPS[i]!(b.doc, b.paragraph);
    await relay.deliver();
  }

  return [a.doc.toJSON(), b.doc.toJSON()];
};

describe("transport-level convergence", () => {
  it("plain delivery converges", async () => {
    const [a, b] = await runScenario("none");
    expect(b).toEqual(a);
  });

  it("every frame duplicated converges to the same state", async () => {
    const [plainA, plainB] = await runScenario("none");
    const [dupA, dupB] = await runScenario("duplicate");
    expect(dupB).toEqual(dupA);
    expect(dupA).toEqual(plainA);
    expect(dupB).toEqual(plainB);
  });

  it("shuffled delivery order converges to the same state", async () => {
    const [plainA, plainB] = await runScenario("none");
    const [shufA, shufB] = await runScenario("shuffle");
    expect(shufB).toEqual(shufA);
    expect(shufA).toEqual(plainA);
    expect(shufB).toEqual(plainB);
  });

  it("kill + reconnect mid-sequence converges to the same state", async () => {
    const [plainA, plainB] = await runScenario("none");
    const [killA, killB] = await runScenario("kill");
    expect(killB).toEqual(killA);
    expect(killA).toEqual(plainA);
    expect(killB).toEqual(plainB);
  });
});
