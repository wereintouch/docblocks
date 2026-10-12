import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import type { DatabaseCellValue, DocJSON } from "../src/schema";

/**
 * The field-level merge claim of the database block (property test,
 * seeded random): two independent docs seeded with the same database
 * exchange a window of ~200 random row ops (setCell — including both
 * sides editing the same cell — insertRow, removeRow, moveRow), applied
 * to a random side, and then the updates are exchanged (deltas, then the
 * full states in a random order with duplicates, the convergence-test
 * pattern). The final state is asserted EQUAL between the two docs; a
 * same-cell conflict resolves to whatever Yjs's last-write semantics
 * converge to (no specific value is asserted). (The final state's
 * validity is NOT asserted: a concurrent moveRow + removeRow of the same
 * row can leave the re-inserted order id behind — the same pre-existing
 * CRDT limitation the moveBlock + removeBlock race has for blocks.)
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const DOC_ID = "d1";
const DB_ID = "db1";

/** Deterministic RNG (mulberry32): the test is reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shared seed database (deterministic block and row ids). */
const SEED: DocJSON = {
  v: 1,
  id: DOC_ID,
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    d1: { type: "root", children: [DB_ID] },
    db1: {
      type: "database",
      attrs: {
        columns: [
          { id: "name", name: "Name", type: "text" },
          { id: "count", name: "Count", type: "number" },
          { id: "done", name: "Done", type: "checkbox" },
          { id: "status", name: "Status", type: "select", options: ["active", "done"] },
          { id: "tags", name: "Tags", type: "multi-select", options: ["a", "b"] },
          { id: "day", name: "Day", type: "date" },
        ],
      },
      rows: {
        r1: { name: "one", done: false, status: "active", tags: ["a"] },
        r2: { name: "two", count: 2, day: "2026-01-01" },
      },
      rowOrder: ["r1", "r2"],
    },
  },
};

const COLUMN_IDS = ["name", "count", "done", "status", "tags", "day"];

/** Valid values per column type (the ops always pick a valid one). */
const VALUES: Record<string, readonly DatabaseCellValue[]> = {
  name: ["alpha", "beta", "gamma"],
  count: [1, 2, 3.5],
  done: [true, false],
  status: ["active", "done"],
  tags: [["a"], ["b"], ["a", "b"], []],
  day: ["2026-01-01", "2026-02-02"],
};

/** One random row op; the row / index targets resolve per side at apply time. */
type Op =
  | { kind: "setCell"; colId: string; value: DatabaseCellValue }
  | { kind: "insertRow" }
  | { kind: "removeRow" }
  | { kind: "moveRow" };

/** Generates ~`count` ops from `rng` (the sequence is fixed per seed). */
function generateOps(rng: () => number, count: number): Op[] {
  const ops: Op[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const colId = COLUMN_IDS[Math.floor(rng() * COLUMN_IDS.length)]!;
    if (roll < 0.55) {
      const values = VALUES[colId]!;
      ops.push({ kind: "setCell", colId, value: values[Math.floor(rng() * values.length)]! });
    } else if (roll < 0.75) {
      ops.push({ kind: "insertRow" });
    } else if (roll < 0.9) {
      ops.push({ kind: "removeRow" });
    } else {
      ops.push({ kind: "moveRow" });
    }
  }
  return ops;
}

/** Applies one op against the side's own current state (its rows / order). */
function applyOp(doc: Doc, op: Op, pick: () => number): void {
  const block = doc.getBlock(DB_ID);
  if (block === null || block.type !== "database") return;
  const order = block.rowOrder;
  switch (op.kind) {
    case "setCell": {
      if (order.length === 0) return;
      doc.setCell(DB_ID, order[Math.floor(pick() * order.length)]!, op.colId, op.value);
      return;
    }
    case "insertRow": {
      doc.insertRow(DB_ID);
      return;
    }
    case "removeRow": {
      if (order.length === 0) return;
      doc.removeRow(DB_ID, order[Math.floor(pick() * order.length)]!);
      return;
    }
    case "moveRow": {
      if (order.length < 2) return;
      doc.moveRow(DB_ID, order[Math.floor(pick() * order.length)]!, Math.floor(pick() * (order.length + 1)));
      return;
    }
  }
}

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/** Full bidirectional exchange: each side applies what the other is missing (A→B then B→A). */
const exchange = (a: Doc, b: Doc): void => {
  b.applyUpdate(deltaOf(a, b));
  a.applyUpdate(deltaOf(b, a));
};

describe("field-level merge (property test)", () => {
  it.each([101, 202, 303])("seed %i: two peers with ~200 random row ops converge to an equal state", (seed) => {
    const rng = mulberry32(seed);
    const ops = generateOps(rng, 200);

    // Two independent docs over the same seed state: the seed's client clocks
    // are shared (the loadDoc-twin pattern), so the converged state stays a
    // valid document (no concurrent-creation duplication of the seed order).
    const seedBytes = fromJSON(SEED).encode();
    const a = loadDoc(seedBytes);
    const b = loadDoc(seedBytes);
    const pickA = mulberry32(seed * 7 + 1);
    const pickB = mulberry32(seed * 7 + 2);

    // A divergent window: both sides edit the SAME cell before any exchange
    // (the conflict the field-level merge must absorb).
    a.setCell(DB_ID, "r1", "name", "from a");
    b.setCell(DB_ID, "r1", "name", "from b");

    const sides = [
      { doc: a, pick: pickA },
      { doc: b, pick: pickB },
    ];
    for (const op of ops) {
      const side = sides[Math.floor(rng() * 2)]!;
      applyOp(side.doc, op, side.pick);
    }

    exchange(a, b);
    // Deep equality: object key order on concurrent peers is not part of the
    // converged state (the cell values and the row order are).
    expect(a.toJSON()).toEqual(b.toJSON());

    // The full states applied in a random order, each twice (duplicates,
    // idempotent): the converged state must stay equal after every pass.
    const aFull = a.encode();
    const bFull = b.encode();
    const passes: Array<"ab" | "ba"> = ["ab", "ba", "ab", "ba", "ab"];
    for (let i = passes.length - 1; i > 0; i--) {
      // Fisher–Yates with the seeded rng
      const j = Math.floor(rng() * (i + 1));
      [passes[i], passes[j]] = [passes[j]!, passes[i]!];
    }
    for (const direction of passes) {
      if (direction === "ab") b.applyUpdate(aFull);
      else a.applyUpdate(bFull);
      expect(a.toJSON()).toEqual(b.toJSON());
    }

    // The database block survived on both sides.
    expect(a.toJSON().blocks[DB_ID]?.type).toBe("database");
    expect(b.toJSON().blocks[DB_ID]?.type).toBe("database");
  });
});
