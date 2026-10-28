import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import type { RootBlock } from "../src";
import { createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";
import { fixture } from "./fixtures";

/**
 * Convergence of independently created documents: two peers that both
 * create the same document from scratch (two createDoc with the same id,
 * or twin fromJSON imports) exchange updates in random order, with losses
 * and duplicates, and must converge to an equal final state — no block
 * lost. Plain createDoc, no relay.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/** Full bidirectional exchange: each side applies what the other is missing (A→B then B→A). */
const exchange = (a: Doc, b: Doc): void => {
  b.applyUpdate(deltaOf(a, b));
  a.applyUpdate(deltaOf(b, a));
};

const expectBothPresent = (a: Doc, b: Doc, pa: string, pb: string): void => {
  // Deep equality: Y.Map key order on concurrent peers is not part of the
  // converged state (the block content and the root's children order are).
  expect(a.toJSON()).toEqual(b.toJSON());
  expect(a.toJSON().blocks).toHaveProperty(pa);
  expect(a.toJSON().blocks).toHaveProperty(pb);
  expect(b.toJSON().blocks).toHaveProperty(pa);
  expect(b.toJSON().blocks).toHaveProperty(pb);
};

describe("independent createDoc peers converge", () => {
  it("sequential edits with exchanges in between converge", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("a") });
    const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });

    const pa = a.insertBlock("paragraph");
    a.insertText(pa, 0, "from a");
    exchange(a, b);

    const pb = b.insertBlock("paragraph");
    b.insertText(pb, 0, "from b");
    exchange(a, b);

    expectBothPresent(a, b, pa, pb);
  });

  it("a divergent window (both insert before any exchange) converges", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("a") });
    const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });

    const pa = a.insertBlock("paragraph");
    a.insertText(pa, 0, "from a");
    const pb = b.insertBlock("paragraph");
    b.insertText(pb, 0, "from b");

    exchange(a, b);

    expectBothPresent(a, b, pa, pb);
  });

  it("twin fromJSON imports of the same fixture converge after one edit each", () => {
    const a = fromJSON(fixture);
    const b = fromJSON(fixture);

    a.insertText("b02", 0, "X");
    b.insertText("b02", 5, "Y");
    exchange(a, b);

    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("fresh copies in both orders, with the second update duplicated, all equal", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("a") });
    const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });

    const pa = a.insertBlock("paragraph");
    a.insertText(pa, 0, "from a");
    const pb = b.insertBlock("paragraph");
    b.insertText(pb, 0, "from b");

    const aFull = a.encode();
    const bFull = b.encode();

    // A fresh copy of each doc as the base, the other's full update applied
    // in both orders, each once and once with the second update duplicated.
    const variants: Array<[Uint8Array, Uint8Array, boolean]> = [
      [aFull, bFull, false],
      [bFull, aFull, false],
      [aFull, bFull, true],
      [bFull, aFull, true],
    ];
    const finals = variants.map(([base, other, duplicate]) => {
      const doc = loadDoc(base);
      doc.applyUpdate(other);
      if (duplicate) doc.applyUpdate(other);
      return doc.toJSON();
    });

    // All four finals are equal (deep equality — Y.Map key order is not part
    // of the converged state), and both paragraphs survived.
    for (const final of finals.slice(1)) expect(final).toEqual(finals[0]);
    const first = JSON.stringify(finals[0]);
    expect(first).toContain(pa);
    expect(first).toContain(pb);
  });

  it("100 iterations of two peers plus one insertBlock each: both ids present on both sides", () => {
    for (let i = 0; i < 100; i++) {
      const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds(`a${i}`) });
      const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds(`b${i}`) });
      const pa = a.insertBlock("paragraph");
      const pb = b.insertBlock("paragraph");

      exchange(a, b);

      expect(a.toJSON().blocks).toHaveProperty(pa);
      expect(a.toJSON().blocks).toHaveProperty(pb);
      expect(b.toJSON().blocks).toHaveProperty(pa);
      expect(b.toJSON().blocks).toHaveProperty(pb);
    }
  });
});

describe("peers loading different shapes converge (legacy vs flat)", () => {
  /** The legacy (nested) shape and its flat twin — the same content. */
  const legacy: DocJSON = {
    v: 1,
    id: "d1",
    title: "",
    createdAt: CREATED_AT,
    blocks: {
      d1: { type: "root", children: ["p1", "l1"] },
      p1: { type: "paragraph", content: [{ text: "base", marks: {} }] },
      l1: { type: "list-item", attrs: { list: "bullet" }, children: ["l2"] },
      l2: { type: "list-item", attrs: { list: "bullet" }, children: ["l3"] },
      l3: { type: "list-item", attrs: { list: "bullet" } },
    },
  };
  const flat: DocJSON = {
    ...legacy,
    blocks: {
      d1: { type: "root", children: ["p1", "l1", "l2", "l3"] },
      p1: legacy.blocks.p1!,
      l1: { type: "list-item", attrs: { list: "bullet" } },
      l2: { type: "list-item", attrs: { list: "bullet", indent: 1 } },
      l3: { type: "list-item", attrs: { list: "bullet", indent: 2 } },
    },
  };

  it("a legacy-shape peer bootstraps a joining peer; both converge to the same flat state", () => {
    // The supported init of a room with two clients: the first joiner's
    // full state is the base (attach's bootstrap) — so the legacy snapshot
    // is loaded by one peer, the other takes it. Independent layouts of
    // one document collide (the shared-skeleton rule), so the joiner
    // never builds its own.
    const base = fromJSON(legacy);
    const joiner = loadDoc(base.encode());

    // Divergent edits after the bootstrap (different blocks, shared ids).
    base.insertText("p1", 0, "A-");
    joiner.insertText("l3", 0, "B-");
    exchange(base, joiner);

    // Deep equality, and the converged state is the flat form + valid.
    expect(base.toJSON()).toEqual(joiner.toJSON());
    const final = base.toJSON();
    expect(validateDoc(final)).toEqual([]);
    expect("children" in (final.blocks.l1 as object)).toBe(false);
    expect((final.blocks.l3 as { attrs?: { indent?: number } }).attrs?.indent).toBe(2);
    const textOf = (id: string): string =>
      "content" in final.blocks[id]! ? (final.blocks[id]!.content ?? []).reduce((t, run) => t + run.text, "") : "";
    expect(textOf("p1")).toBe("A-base");
    expect(textOf("l3")).toBe("B-");
  });

  it("loadDoc of each shape lands on the same bytes", () => {
    const fromLegacy = loadDoc(fromJSON(legacy).encode());
    const fromFlat = loadDoc(fromJSON(flat).encode());
    expect(JSON.stringify(fromLegacy.toJSON())).toBe(JSON.stringify(fromFlat.toJSON()));
  });
});

/**
 * A deterministic reseed against a persistent sync room: two peers seed the
 * same deterministic document (the same id generator) and merge — the Yjs
 * order array ends up holding the same id twice (one insert per peer).
 * Reads are self-healing (the first occurrence wins), so getChildren and
 * toJSON stay well-formed regardless of how many times the room was seeded.
 */
describe("deterministic reseed (duplicate order entries)", () => {
  const seed = (doc: Doc): void => {
    doc.transact(() => {
      const heading = doc.insertBlock("heading", { level: 1 });
      doc.insertText(heading, 0, "Heading");
      doc.insertBlock("paragraph");
      doc.insertBlock("divider");
    });
  };

  it("dedupes the root order and the exported JSON after a merge", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("c") });
    const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("c") });
    seed(a);
    seed(b);
    exchange(a, b);

    const children = a.getChildren("d1");
    expect(children).toEqual(["c0", "c1", "c2"]);
    expect(new Set(children).size).toBe(children.length);
    expect(a.toJSON()).toEqual(b.toJSON());
    expect((a.toJSON().blocks.d1 as RootBlock).children).toEqual(["c0", "c1", "c2"]);
  });
});

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

/**
 * Concurrent formatting and text edits over a shared paragraph. The text
 * is a single Y.Text with mark attributes, so formatting is a pure attribute
 * operation (no text copy) and character identity survives concurrent
 * formatting and deletion. These are theacceptance criteria: the text
 * stays intact, the converged state reloads, and re-delivery is idempotent.
 */
describe("concurrent formatting and text edits keep the text valid", () => {
  const seed = (id: string): { a: Doc; blockId: string } => {
    const a = createDoc({ id, createdAt: CREATED_AT, generateId: makeIds(id) });
    const blockId = a.insertBlock("paragraph");
    a.insertText(blockId, 0, "abcdef");
    return { a, blockId };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());

  it("concurrent bold + italic keep the text intact (a->b delivery)", () => {
    const { a, blockId } = seed("f01-fmt");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    b.setMark(blockId, 2, 5, { type: "italic" });
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcdef");
    expect(b.getText(blockId)).toBe("abcdef");
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent formatting + deletion keep the text valid", () => {
    const { a, blockId } = seed("f01-del");
    const b = fork(a);
    // A bolds [3,6); B deletes [4,6) ("ef").
    a.setMark(blockId, 3, 6, { type: "bold" });
    b.deleteText(blockId, 4, 6);
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcd");
    expect(b.getText(blockId)).toBe("abcd");
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("concurrent formatting + insertion keep the text valid", () => {
    const { a, blockId } = seed("f01-ins");
    const b = fork(a);
    // A bolds [0,3); B inserts "XY" at 3.
    a.setMark(blockId, 0, 3, { type: "bold" });
    b.insertText(blockId, 3, "XY");
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcXYdef");
    expect(b.getText(blockId)).toBe("abcXYdef");
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("undo/redo of a format over a remote edit keeps the text valid", () => {
    const { a, blockId } = seed("f01-undo");
    const b = fork(a);
    a.setMark(blockId, 0, 6, { type: "bold" });
    b.insertText(blockId, 6, "!");
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcdef!");
    a.undo(); // undo the bold
    expect(a.getText(blockId)).toBe("abcdef!");
    expect(a.getRuns(blockId).every((run) => run.marks.bold === undefined)).toBe(true);
    a.redo(); // redo the bold
    expect(a.getText(blockId)).toBe("abcdef!");
    expect(a.getRuns(blockId).some((run) => run.marks.bold === true)).toBe(true);
  });

  it("re-delivery of the same update is idempotent", () => {
    const { a, blockId } = seed("f01-redeliver");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    const update = a.encode();
    b.applyUpdate(update);
    b.applyUpdate(update); // the same update twice
    expect(b.getText(blockId)).toBe("abcdef");
    expect(b.toJSON()).toEqual(loadDoc(update).toJSON());
  });

  it("the merged state reloads as a valid snapshot", () => {
    const { a, blockId } = seed("f01-reload");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    b.setMark(blockId, 2, 5, { type: "italic" });
    exchange(a, b);
    const reloaded = loadDoc(a.encode());
    expect(reloaded.getText(blockId)).toBe("abcdef");
    expect(validateDoc(reloaded.toJSON())).toEqual([]);
    expect(reloaded.toJSON()).toEqual(a.toJSON());
  });
});

/**
 *acceptance: the block owner is a single CRDT-resolved `parent` field
 * (set by insert/move/load), so any two concurrent moves of the same block
 * resolve to exactly one owner — not a duplicate reference in two
 * containers' children arrays. Deleting the losing container preserves the
 * block and its text; the final state reloads as a valid snapshot.
 */
describe("concurrent moves keep a single owner", () => {
  const seed = (id: string): { a: Doc; blockId: string } => {
    const a = createDoc({ id });
    const blockId = a.insertBlock("paragraph");
    a.insertText(blockId, 0, "moved block");
    return { a, blockId };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());
  const exchange = (a: Doc, b: Doc): void => {
    const aBytes = a.encode();
    const bBytes = b.encode();
    a.applyUpdate(bBytes);
    b.applyUpdate(aBytes);
  };

  /** The container ids (from the JSON children) that list `blockId`. */
  const ownersOf = (json: DocJSON, blockId: string): string[] =>
    Object.entries(json.blocks)
      .filter(([, block]) => ((block as { children?: readonly string[] }).children ?? []).includes(blockId))
      .map(([parentId]) => parentId);

  const twoFrames = (a: Doc, surface: string) => {
    const frameA = a.insertBlock("frame", undefined, { parent: surface });
    const frameB = a.insertBlock("frame", undefined, { parent: surface });
    return { frameA, frameB };
  };

  it("a block has exactly one owner after two concurrent moves", () => {
    const { a, blockId } = seed("f02-single");
    const surface = a.insertBlock("surface");
    const { frameA, frameB } = twoFrames(a, surface);
    const b = fork(a);
    a.moveBlock(blockId, frameA, 0);
    b.moveBlock(blockId, frameB, 0);
    exchange(a, b);
    const owners = ownersOf(a.toJSON(), blockId);
    expect(owners).toHaveLength(1);
    expect([frameA, frameB]).toContain(owners[0]!);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("deleting the losing container preserves the block and its text", () => {
    const { a, blockId } = seed("f02-keep");
    const surface = a.insertBlock("surface");
    const { frameA, frameB } = twoFrames(a, surface);
    const b = fork(a);
    a.moveBlock(blockId, frameA, 0);
    b.moveBlock(blockId, frameB, 0);
    exchange(a, b);
    const owner = ownersOf(a.toJSON(), blockId)[0]!;
    const loser = owner === frameA ? frameB : frameA;
    a.removeBlock(loser);
    expect(a.getBlock(blockId)).not.toBeNull();
    expect(a.getText(blockId)).toBe("moved block");
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("deleting the winning container removes the block", () => {
    const { a, blockId } = seed("f02-drop");
    const surface = a.insertBlock("surface");
    const { frameA, frameB } = twoFrames(a, surface);
    const b = fork(a);
    a.moveBlock(blockId, frameA, 0);
    b.moveBlock(blockId, frameB, 0);
    exchange(a, b);
    const owner = ownersOf(a.toJSON(), blockId)[0]!;
    a.removeBlock(owner);
    expect(a.getBlock(blockId)).toBeNull();
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("undo of a move restores the block to its original container", () => {
    const { a, blockId } = seed("f02-undo");
    const surface = a.insertBlock("surface");
    const frameA = a.insertBlock("frame", undefined, { parent: surface });
    a.moveBlock(blockId, frameA, 0);
    expect(ownersOf(a.toJSON(), blockId)).toEqual([frameA]);
    a.undo();
    // Back at the top level: the root (id === the doc id) lists it.
    expect(ownersOf(a.toJSON(), blockId)).toEqual([a.toJSON().id]);
    expect(a.getText(blockId)).toBe("moved block");
  });

  it("the merged state reloads as a valid snapshot with one owner", () => {
    const { a, blockId } = seed("f02-reload");
    const surface = a.insertBlock("surface");
    const { frameA, frameB } = twoFrames(a, surface);
    const b = fork(a);
    a.moveBlock(blockId, frameA, 0);
    b.moveBlock(blockId, frameB, 0);
    exchange(a, b);
    const reloaded = loadDoc(a.encode());
    const json = reloaded.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(ownersOf(json, blockId)).toHaveLength(1);
    expect(reloaded.getText(blockId)).toBe("moved block");
    expect(json).toEqual(a.toJSON());
  });
});

/**
 *acceptance: the surface's children order is the single source of the
 * z-order, and the dense `zIndex` is derived from it at read time (and on
 * load). Concurrent inserts / removes / reorders of canvas elements keep a
 * valid order; the snapshot after each merge passes validateDoc and loadDoc.
 */
describe("concurrent canvas z-order keeps a valid order", () => {
  const seedSurface = (id: string): { a: Doc; surface: string } => {
    const a = createDoc({ id });
    const surface = a.insertBlock("surface");
    return { a, surface };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());
  const exchange = (a: Doc, b: Doc): void => {
    const aBytes = a.encode();
    const bBytes = b.encode();
    a.applyUpdate(bBytes);
    b.applyUpdate(aBytes);
  };
  const zIndexOf = (json: DocJSON, blockId: string): number | undefined =>
    (json.blocks[blockId] as { attrs?: { zIndex?: number } })?.attrs?.zIndex;
  const canvasChildrenOf = (json: DocJSON, surfaceId: string): string[] =>
    ((json.blocks[surfaceId] as { children?: string[] }).children ?? []).filter((childId) => {
      const type = (json.blocks[childId] as { type?: string }).type;
      return type === "shape" || type === "connector" || type === "canvas-text" || type === "group";
    });

  it("two concurrent inserts yield a dense zIndex and a reloadable snapshot", () => {
    const { a, surface } = seedSurface("f03-insert");
    const b = fork(a);
    const shapeA = a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const shapeB = b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    // Dense 1..N over the two shapes (derived from the merged children order).
    const zIndexes = [shapeA, shapeB].map((id) => zIndexOf(json, id)).sort();
    expect(zIndexes).toEqual([1, 2]);
  });

  it("a concurrent insert and remove keep a valid order", () => {
    const { a, surface } = seedSurface("f03-rm");
    const first = a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = fork(a);
    a.removeBlock(first);
    b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    exchange(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it("a concurrent reorder keeps a dense order and a valid snapshot", () => {
    const { a, surface } = seedSurface("f03-reorder");
    const s1 = a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const s3 = a.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    const b = fork(a);
    a.setZOrder(s1, "toFront");
    b.setZOrder(s3, "toBack");
    exchange(a, b);
    const json = a.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
    const ids = canvasChildrenOf(json, surface);
    const zIndexes = ids.map((id) => zIndexOf(json, id));
    expect(zIndexes).toEqual([1, 2, 3]);
  });

  it("the merged state reloads with the same dense zIndex", () => {
    const { a, surface } = seedSurface("f03-reload");
    const b = fork(a);
    const shapeA = a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const shapeB = b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    exchange(a, b);
    const before = [shapeA, shapeB].map((id) => zIndexOf(a.toJSON(), id)).sort();
    const reloaded = loadDoc(a.encode());
    const json = reloaded.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect([shapeA, shapeB].map((id) => zIndexOf(json, id)).sort()).toEqual(before);
    expect(json).toEqual(a.toJSON());
  });
});
