import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { Block, Geometry } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The geometry's layout / reads boundary (the sibling of geometry.test.ts):
 * the round trip, the plain snapshots, the nested Y.Map image, the
 * reactivity, the concurrency's convergence, and the determinism.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

const GEOMETRY: Geometry = { x: -40, y: 20, w: 120, h: 80 };

describe("layout and reads", () => {
  it("round-trips the geometry: toJSON -> fromJSON -> toJSON is identical", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);
    const before = doc.toJSON();

    const restored = fromJSON(before);
    expect(restored.toJSON()).toEqual(before);
    expect(restored.getBlock(p)).toEqual({ type: "paragraph", geometry: GEOMETRY });
  });

  it("reads stay plain snapshots (the plainness contract extends to the geometry)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);
    const block = doc.getBlock(p);
    expect(block).not.toBeNull();
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(doc.toJSON());
    // The snapshot is a fresh plain copy: mutating it does nothing.
    (block?.geometry as Record<string, unknown> | undefined)!.x = 999;
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: GEOMETRY });
  });

  it("the layout image is a nested Y.Map of numbers (the isomorphic contract)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);

    const yblock = doc.raw.getMap("blocks").get(p) as Y.Map<unknown>;
    const geometry = yblock.get("geometry");
    expect(geometry).toBeInstanceOf(Y.Map);
    for (const [key, value] of Object.entries(GEOMETRY)) {
      expect((geometry as Y.Map<unknown>).get(key)).toBe(value);
    }
  });

  it("a remote geometry update is delivered and read plain", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT });
    const b = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: () => "p1" });
    const p = b.insertBlock("paragraph");
    b.setGeometry(p, GEOMETRY);

    // B's full state (the paragraph + its geometry) arrives at A as a
    // remote update: the nested geometry map is applied over the wire.
    const seen: string[][] = [];
    const unsub = a.onChange((change) => seen.push(change.blockIds));
    a.applyUpdate(b.encode());
    unsub();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain(p);
    expect(a.getBlock(p)).toEqual({ type: "paragraph", geometry: GEOMETRY });
    expect(validateDoc(a.toJSON())).toEqual([]);
  });
});

describe("reactivity", () => {
  it("geometry changes reach onChange / onBlock (observeDeep covers the nested field)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, { x: 0, y: 0, w: 10, h: 10 });

    const changes: string[][] = [];
    const snapshots: Block[] = [];
    const unsubChange = doc.onChange((change) => changes.push(change.blockIds));
    const unsubBlock = doc.onBlock(p, (block) => snapshots.push(block));

    doc.setGeometry(p, { x: 5 });
    doc.setGeometry(p, null);

    unsubChange();
    unsubBlock();
    expect(changes.length).toBe(2);
    expect(changes.every((ids) => ids.includes(p))).toBe(true);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.geometry).toEqual({ x: 5, y: 0, w: 10, h: 10 });
    expect(snapshots[1]).toEqual({ type: "paragraph" });
  });
});

describe("concurrency", () => {
  it("concurrent geometry sets converge (per-key LWW, the same doc state)", () => {
    const make = (prefix: string): Doc => {
      let n = 0;
      return createDoc({ id: "d1", createdAt: CREATED_AT, generateId: () => `${prefix}${n++}` });
    };
    const a = make("a");
    const b = make("b");
    const pa = a.insertBlock("paragraph");
    const pb = b.insertBlock("paragraph");

    a.setGeometry(pa, { x: 1, y: 2, w: 3, h: 4 });
    b.setGeometry(pb, { x: 1, y: 2, w: 3, h: 4 });
    // The divergent window: both set the same block field before any exchange.
    a.applyUpdate(b.encode());
    b.applyUpdate(a.encode());

    // Both sides now hold two paragraphs; the shared id is the one both
    // peers created last… (the ids differ — the geometry landed on each
    // peer's own block). Convergence: equal final state.
    expect(a.toJSON()).toEqual(b.toJSON());

    // A follow-up partial on one side reaches the other.
    const sharedA = a.getChildren(a.meta.id)[1]!;
    const sharedB = b.getChildren(b.meta.id)[1]!;
    a.setGeometry(sharedA, { w: 120 });
    b.applyUpdate(a.encode());
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.getBlock(sharedA)?.geometry).toEqual(b.getBlock(sharedB)?.geometry);
    expect(a.getBlock(sharedA)?.geometry).toMatchObject({ w: 120 });
  });
});

describe("determinism", () => {
  it("same commands + injected ids -> equal toJSON", () => {
    const make = (): Doc => {
      let n = 0;
      return createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `b${n++}` });
    };
    const run = (doc: Doc): void => {
      const p = doc.insertBlock("paragraph");
      doc.setGeometry(p, GEOMETRY);
      doc.setGeometry(p, { x: 7 });
      const q = doc.insertBlock("heading", { level: 1 });
      doc.setGeometry(q, { x: 0, y: 0, w: 50, h: 50 });
      doc.setGeometry(q, null);
    };
    const first = make();
    const second = make();
    run(first);
    run(second);
    expect(first.toJSON()).toEqual(second.toJSON());
  });
});
