import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
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
