import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidGeometryError, UnknownBlockError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { Block, Geometry } from "../src/schema";
import { validateDoc } from "../src/schema";

/**
 * The setGeometry command: the canvas geometry is a block field (not an
 * attr) — a partial patch merges with the existing geometry (the result
 * must be complete), `null` removes it, equal-value sets are no-ops. The
 * layout/reads boundary (the nested Y.Map image, the plain snapshots, the
 * reactivity) is pinned here; the canvas types themselves are
 * canvas.test.ts.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

const GEOMETRY: Geometry = { x: -40, y: 20, w: 120, h: 80, rotation: 15 };

describe("setGeometry", () => {
  it("sets the full geometry on any block type", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const table = doc.insertBlock("table", { cols: 2 });

    doc.setGeometry(p, GEOMETRY);
    doc.setGeometry(table, { x: 0, y: 0, w: 300, h: 200 });

    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: GEOMETRY });
    expect(doc.getBlock(table)).toEqual({
      type: "table",
      attrs: { cols: 2 },
      geometry: { x: 0, y: 0, w: 300, h: 200 },
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("stands the group's own box (the container's free geometry)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = doc.insertBlock("group", { members: [a] }, { parent: surface });

    // A partial patch on a group without a geometry is an error (incomplete).
    expectThrows(() => doc.setGeometry(group, { x: 5 }), InvalidGeometryError);
    // A complete patch stands the box (the group's own free geometry).
    doc.setGeometry(group, { x: 0, y: 0, w: 200, h: 100 });
    expect(doc.getBlock(group)).toEqual({
      type: "group",
      attrs: { members: [a] },
      geometry: { x: 0, y: 0, w: 200, h: 100 },
    });
    // The partial patch merges.
    doc.setGeometry(group, { w: 300 });
    expect(doc.getBlock(group)).toEqual({
      type: "group",
      attrs: { members: [a] },
      geometry: { x: 0, y: 0, w: 300, h: 100 },
    });
    // The removal path drops the geometry.
    doc.setGeometry(group, null);
    expect(doc.getBlock(group)).toEqual({ type: "group", attrs: { members: [a] } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a partial patch merges with the existing geometry", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, { x: 0, y: 0, w: 100, h: 50 });

    doc.setGeometry(p, { x: 10 });
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 10, y: 0, w: 100, h: 50 } });

    doc.setGeometry(p, { rotation: 90, h: 60 });
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 10, y: 0, w: 100, h: 60, rotation: 90 } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a partial without an existing geometry -> InvalidGeometryError (the doc is untouched)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const before = doc.toJSON();

    const error = expectThrows(() => doc.setGeometry(p, { x: 1 }), InvalidGeometryError);
    expect(error.message).toContain(p);
    expect(doc.toJSON()).toEqual(before);
  });

  it("rejects bad values with InvalidGeometryError (the doc is untouched)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);
    const before = doc.toJSON();

    const cases: Array<Partial<Geometry>> = [
      { x: Number.NaN },
      { y: Number.POSITIVE_INFINITY },
      { w: 0 },
      { h: -1 },
      { rotation: Number.NaN },
    ];
    for (const patch of cases) {
      expectThrows(() => doc.setGeometry(p, patch), InvalidGeometryError);
    }
    expect(doc.toJSON()).toEqual(before); // every throw left the doc untouched
  });

  it("null removes the geometry (the block returns to the flow)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);
    doc.setGeometry(p, null);
    expect(doc.getBlock(p)).toEqual({ type: "paragraph" });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("no-ops emit zero update bytes (equal-value set, null without geometry)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const q = doc.insertBlock("divider");
    doc.setGeometry(p, GEOMETRY);
    const before = doc.encode().byteLength;

    doc.setGeometry(p, GEOMETRY); // the same values
    doc.setGeometry(p, { x: GEOMETRY.x, rotation: GEOMETRY.rotation }); // a redundant partial
    doc.setGeometry(q, null); // no geometry to remove (twice)
    doc.setGeometry(q, null);
    expect(doc.encode().byteLength).toBe(before);
  });

  it("unknown block -> UnknownBlockError", () => {
    const doc = newDoc();
    expectThrows(() => doc.setGeometry("nope", GEOMETRY), UnknownBlockError);
    expectThrows(() => doc.setGeometry("nope", null), UnknownBlockError);
  });
});

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
    a.setGeometry(sharedA, { rotation: 45 });
    b.applyUpdate(a.encode());
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.getBlock(sharedA)?.geometry).toEqual(b.getBlock(sharedB)?.geometry);
    expect(a.getBlock(sharedA)?.geometry).toMatchObject({ rotation: 45 });
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
