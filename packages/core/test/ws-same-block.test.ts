// Wire-level same-block concurrency (the format / the
// insert / the delete of one Y.Text through the relay): the peers edit the
// SAME block (the existing wire suites' peers each edit their own block —
// the same-block race was pinned at the core level over the raw
// applyUpdate only). The stands:
//
// - the peers converge on each other over the multi-seed's frame
//   permutations (the sync contract's invariant — the final state is
//   identical on both peers).
// - the TEXT stands order-independent across the seeds. The mark's
//   attribution at the concurrent format + insert's SHARED boundary
//   (the inserted character stands in or out of the formatted range)
//   stands the Yjs's application order: the format's range resolves
//   against the items at the integration time, and a concurrent insert
//   at the range's edge is included or not per the peers' application
//   order (the Yjs 13 property, pinned here as the boundary stand — the
//   peers agree, the global order picks the boundary's attribution).
import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { attach } from "../src/sync";
import { WsSyncProvider } from "../src/sync/ws-provider";
import { WsRelay } from "./ws-relay";

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "same-block";
const URL = "ws://relay/same-block";
// The peer's block id's stand (the generator's first value): the shared
// paragraph's id is deterministic over the seeds (A's creation stands).
const SHARED_ID = "a0";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** Per-seed the block id's generator (the peer's own ids). */
interface Side {
  provider: WsSyncProvider;
  doc: Doc;
}

/** The seeds' permutations set (the multi-seed's stand over the one 42). */
const SEEDS = [42, 137, 999, 2026, 31415] as const;

const runScenario = async (
  seed: number,
  chaos: { duplicate?: boolean; shuffle?: boolean }
): Promise<[ReturnType<Doc["toJSON"]>, ReturnType<Doc["toJSON"]>]> => {
  const relay = new WsRelay(seed);
  if (chaos.duplicate) relay.setDuplicateAll(true);
  if (chaos.shuffle) relay.setShuffleAll(true);

  const make = (idPrefix: string): Side => {
    const provider = new WsSyncProvider(URL, { webSocketImpl: (u) => relay.connect(u)! });
    const doc = createDoc({ id: DOC_ID, createdAt: CREATED_AT, generateId: makeIds(idPrefix) });
    attach(doc, provider);
    return { provider, doc };
  };
  const a = make("a");
  const b = make("b");
  await a.provider.connect();
  await b.provider.connect();
  await relay.deliver();

  // The shared block: A's creation, synced (both peers hold the same
  // blockId — the same-block's race, not the two-blocks' one).
  const shared = a.doc.insertBlock("paragraph");
  expect(shared).toBe(SHARED_ID);
  a.doc.insertText(shared, 0, "concurrent text");
  await relay.deliver();

  // The concurrent window: each peer's ops over the SAME block (the
  // frames interleave over the relay — no intermediate delivery).
  const opsA: Array<(doc: Doc, id: string) => void> = [
    (d, id) => d.setMark(id, 0, 4, { type: "bold" }), // the format's range
    (d, id) => d.insertText(id, 4, "X"), // the insert at the format's edge
    (d, id) => d.deleteText(id, 4, 5), // the delete over the formatted range
  ];
  const opsB: Array<(doc: Doc, id: string) => void> = [
    (d, id) => d.insertText(id, 4, "Y"), // the insert at the format's edge
    (d, id) => d.setMark(id, 5, 9, { type: "italic" }),
    (d, id) => d.deleteText(id, 13, 16), // the delete of the tail's range
  ];
  const len = Math.max(opsA.length, opsB.length);
  for (let i = 0; i < len; i += 1) {
    opsA[i]?.(a.doc, shared);
    opsB[i]?.(b.doc, shared);
    await relay.deliver();
  }

  return [a.doc.toJSON(), b.doc.toJSON()];
};

const sharedTextOf = (snapshot: ReturnType<Doc["toJSON"]>): string => {
  const block = snapshot.blocks[SHARED_ID];
  const content = block !== undefined && block !== null && "content" in block ? block.content : undefined;
  return content === undefined ? "" : content.map((run) => run.text).join("");
};

describe("the wire-level same-block concurrency over the relay", () => {
  it("the peers converge over the concurrent format / insert / delete (the multi-seed's stand)", async () => {
    for (const seed of SEEDS) {
      const [a, b] = await runScenario(seed, {});
      expect(b, `the peers diverge (seed ${seed})`).toEqual(a);
    }
  });

  it("the text stands order-independent over the seeds (the boundary's mark attribution is the Yjs's order stand)", async () => {
    const [baseA] = await runScenario(SEEDS[0]!, {});
    const baseText = sharedTextOf(baseA);
    expect(baseText).not.toBe("");
    for (const seed of SEEDS.slice(1)) {
      const [a] = await runScenario(seed, {});
      expect(sharedTextOf(a), `the text drifts over the seed's permutation (seed ${seed})`).toBe(baseText);
    }
  });

  it("stands the frame duplication (the delivery's idempotency)", async () => {
    const [a, b] = await runScenario(42, { duplicate: true });
    expect(b).toEqual(a);
  });

  it("stands the shuffled delivery (the frame order's stand)", async () => {
    const [a, b] = await runScenario(42, { shuffle: true });
    expect(b).toEqual(a);
  });
});
