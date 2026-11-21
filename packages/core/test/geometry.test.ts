import { describe, expect, it } from "vitest";

import { InvalidGeometryError, UnknownBlockError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import type { Geometry } from "../src/schema";
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

const GEOMETRY: Geometry = { x: -40, y: 20, w: 120, h: 80 };

describe("setGeometry", () => {
  it("sets the full geometry on any block type", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const table = doc.insertBlock("table", { cols: 2 });

    doc.setGeometry(p, GEOMETRY);
    doc.setGeometry(table, { x: 0, y: 0, w: 300, h: 200 });

    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: GEOMETRY });
    const tableBlock = doc.getBlock(table) as { type: "table"; columnOrder: string[]; geometry: unknown };
    expect(tableBlock.type).toBe("table");
    expect(tableBlock.columnOrder).toHaveLength(2);
    expect(tableBlock.geometry).toEqual({ x: 0, y: 0, w: 300, h: 200 });
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
      attrs: { members: [a], zIndex: 2 },
      geometry: { x: 0, y: 0, w: 200, h: 100 },
    });
    // The partial patch merges.
    doc.setGeometry(group, { w: 300 });
    expect(doc.getBlock(group)).toEqual({
      type: "group",
      attrs: { members: [a], zIndex: 2 },
      geometry: { x: 0, y: 0, w: 300, h: 100 },
    });
    // The removal path drops the geometry.
    doc.setGeometry(group, null);
    expect(doc.getBlock(group)).toEqual({ type: "group", attrs: { members: [a], zIndex: 2 } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a partial patch merges with the existing geometry", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, { x: 0, y: 0, w: 100, h: 50 });

    doc.setGeometry(p, { x: 10 });
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 10, y: 0, w: 100, h: 50 } });

    doc.setGeometry(p, { h: 60 });
    expect(doc.getBlock(p)).toEqual({ type: "paragraph", geometry: { x: 10, y: 0, w: 100, h: 60 } });
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
      { w: Number.NaN },
    ];
    for (const patch of cases) {
      expectThrows(() => doc.setGeometry(p, patch), InvalidGeometryError);
    }
    expect(doc.toJSON()).toEqual(before); // every throw left the doc untouched
  });

  it("rejects a patch carrying the rotation key with InvalidGeometryError (the doc is untouched)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.setGeometry(p, GEOMETRY);
    const before = doc.toJSON();

    // A rotation-only patch is rejected, not a silent no-op.
    const rotationOnly = expectThrows(
      () => doc.setGeometry(p, { rotation: 45 } as Partial<Geometry>),
      InvalidGeometryError
    );
    expect(rotationOnly.message).toContain("rotation");
    // A mixed patch carrying the key is rejected too.
    const mixed = expectThrows(
      () => doc.setGeometry(p, { rotation: 45, h: 100 } as Partial<Geometry>),
      InvalidGeometryError
    );
    expect(mixed.message).toContain("rotation");
    expect(doc.toJSON()).toEqual(before); // the rejects left the doc untouched
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
    doc.setGeometry(p, { x: GEOMETRY.x }); // a redundant partial
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
