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
