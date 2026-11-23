import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { RootBlock } from "../src";
import { createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/** Full bidirectional exchange: each side applies what the other is missing (A→B then B→A). */
const exchange = (a: Doc, b: Doc): void => {
  b.applyUpdate(deltaOf(a, b));
  a.applyUpdate(deltaOf(b, a));
};

/**
 * A concurrent moveBlock + removeBlock of the same block: the move's
 * delete + reinsert races the remove's delete on the same order element,
 * so the re-inserted child id can survive with no block entry (a dangling
 * order id). The lenient read drops it: getChildren and toJSON stay
 * well-formed on both peers (the raw Yjs layer keeps the id — doc.raw is
 * the escape hatch; the data is not rewritten).
 */
describe("the moveBlock + removeBlock race (the dangling child id)", () => {
  const makeSeed = (): Uint8Array =>
    fromJSON({
      v: 1,
      id: "d-race",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        "d-race": { type: "root", children: ["b1", "b2", "b3"] },
        b1: { type: "paragraph", content: [{ text: "one", marks: {} }] },
        b2: { type: "paragraph", content: [{ text: "two", marks: {} }] },
        b3: { type: "paragraph", content: [{ text: "three", marks: {} }] },
      },
    } as DocJSON).encode();

  it("converges to an equal, valid state (either race outcome is valid)", () => {
    const a = loadDoc(makeSeed());
    const b = loadDoc(makeSeed());

    // The race: A moves b2 to the end (delete + reinsert in the root
    // order), B removes b2 (the order id + the block entry). The two
    // order-array writes are concurrent, and the merge winner is the
    // client-id order (random per run) — either outcome is a valid
    // converged state: the remove wins (the id is dropped), or the move
    // wins (the re-inserted id stands, and the entry may stand with it —
    // the moved block survives the race).
    a.moveBlock("b2", "d-race", 3);
    b.removeBlock("b2");
    exchange(a, b);

    // Convergence: the peers are equal, and the doc stands the strict
    // validator in either outcome (a survivor block is a normal block).
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(validateDoc(a.toJSON())).toEqual([]);

    // The lenient read's contract: the JSON's children are the raw order
    // (deduped) filtered by the entry's presence — a dangling id (order id
    // without an entry) is dropped, a survivor id (the entry stands) keeps
    // its slot.
    const raw = a.getChildren("d-race");
    expect(raw.slice(0, 2)).toEqual(["b1", "b3"]);
    const entryAlive = a.getBlock("b2") !== null;
    if (raw[2] !== undefined) expect(raw[2]).toBe("b2");
    const rootJson = a.toJSON().blocks["d-race"] as { children?: string[] };
    expect(rootJson?.children).toEqual(raw.filter((id) => id !== "b2" || entryAlive));
  });

  it("drops the dangling order id on the read (deterministic raw-level pin)", () => {
    // The race's dangling case, pinned without the race: the order id
    // stands with no block entry (the raw Yjs layer is the escape hatch —
    // the data is not rewritten) — the read drops the id, the doc stays
    // valid, and the raw array keeps the id (doc.raw is the escape hatch).
    const a = createDoc({ id: "d-dangle", createdAt: CREATED_AT });
    const p = a.insertBlock("paragraph");
    a.raw.getMap("blocks").delete(p);

    expect(a.getChildren("d-dangle")).toEqual([]);
    expect(a.getBlock(p)).toBeNull();
    // The raw layer keeps the id (the lenient read filters, not the data).
    expect(a.raw.getArray("rootOrder").toArray()).toEqual([p]);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });
});

/**
 * A concurrent moveBlock(b, into s) + removeBlock(s): if the remove's
 * cascade runs before the move lands on the remote peer, the move
 * re-inserts b into the removed parent's children — b's entry survives
 * with no order slot (an orphan entry: unreachable from root).
 * Documented CRDT limit: the abort/rollback is not
 * expressible (the command commits locally at the call; the conflict is
 * discoverable only post-convergence, and both peers saw the move
 * succeed), so the read path is lenient by construction (the tree reads
 * never surface the unreachable entry), the data is not rewritten
 * (doc.raw is the escape hatch), and the strict validator flags the
 * entry. The v1 UI cannot stand the state (no cross-parent move — the
 * drag stands one sequence); the public core API can.
 */
describe("the moveBlock + removeBlock-of-parent race (the orphan entry)", () => {
  const makeSeed = (): Uint8Array =>
    fromJSON({
      v: 1,
      id: "d-orphan",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        "d-orphan": { type: "root", children: ["surf1", "p1"] },
        surf1: { type: "surface", children: [] },
        p1: { type: "paragraph", content: [{ text: "moved", marks: {} }] },
      },
    } as DocJSON).encode();

  it("converges to the orphan shape: the entry survives, the order slot is gone", () => {
    // Both peers load the SAME settled seed (one authoring client): a fresh
    // makeSeed per peer is a concurrent init (two seed clients), and the
    // merge then keeps the peer's own root-order slot (a different, valid
    // outcome — the orphan needs the shared-seed race).
    const seed = makeSeed();
    const a = loadDoc(seed);
    const b = loadDoc(seed);

    // The race: A moves p1 into the surface (delete from the root order +
    // insert into the surface's children), B removes the surface (the
    // cascade drops the entry and its children array before the move lands).
    a.moveBlock("p1", "surf1", 0);
    b.removeBlock("surf1");
    exchange(a, b);

    // Convergence: the peers stand the equal state, and the orphan shape
    // stands on both (deterministic — the root-order delete wins the
    // race, the entry survives the cascade that predates the move).
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.getBlock("p1")).not.toBeNull();
    expect(a.getBlock("surf1")).toBeNull();
    // The lenient read by construction: p1 is unreachable from root —
    // the tree reads never surface it (the JSON's root order has no p1,
    // the surface is gone with its children array).
    const json = a.toJSON();
    expect((json.blocks["d-orphan"] as RootBlock).children).toEqual([]);
    expect(json.blocks["p1"]).toBeDefined();
    // The strict validator flags the entry (the data is flagged, not hidden).
    expect(validateDoc(json).map((entry) => entry.message)).toContain(`Orphan block "p1" (unreachable from root).`);
  });

  it("the orphan entry stands the raw-level read (deterministic pin, no race)", () => {
    // The converged shape pinned without the race: the order slot vanishes
    // while the block entry survives — the tree read drops it, the
    // explicit-id read stands the snapshot (the data is not rewritten),
    // the raw layer keeps the entry (doc.raw is the escape hatch).
    const a = createDoc({ id: "d-orphan2", createdAt: CREATED_AT });
    a.insertBlock("paragraph");
    const q = a.insertBlock("paragraph");
    const rootOrder = a.raw.getArray("rootOrder");
    rootOrder.delete(rootOrder.toArray().indexOf(q), 1);

    expect(a.getChildren("d-orphan2")).not.toContain(q);
    expect(a.getBlock(q)).not.toBeNull();
    expect(a.raw.getMap("blocks").has(q)).toBe(true);
    expect(validateDoc(a.toJSON()).map((entry) => entry.message)).toContain(
      `Orphan block "${q}" (unreachable from root).`
    );
  });
});
