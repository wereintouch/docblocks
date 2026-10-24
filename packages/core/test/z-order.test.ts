import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidOperationError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * The canvas z-order command (setZOrder) + the dense zIndex invariant. The
 * canvas elements (shape / connector / canvas-text / group) of a surface
 * carry an explicit `zIndex` (dense 1..N, the children order's mirror —
 * 1 = bottom). The command reorders the surface's canvas elements
 * (forward / back / toFront / toBack) and rewrites the `zIndex` (dense, in
 * the new order) in one transaction.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";
const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

/** A surface with the given canvas element types (in order). */
function surfaceWith(doc: Doc, types: ("rect" | "ellipse" | "connector")[]): { surface: string; ids: string[] } {
  const surface = doc.insertBlock("surface");
  const ids: string[] = [];
  for (const variant of types) {
    const id =
      variant === "connector"
        ? doc.insertBlock("connector", { start: { x: 0, y: 0 }, end: { x: 1, y: 1 } }, { parent: surface })
        : doc.insertBlock("shape", { variant }, { parent: surface });
    ids.push(id);
  }
  return { surface, ids };
}

/** The zIndex of a surface child (the dense index; -1 when absent). */
function zOf(doc: Doc, id: string): number {
  const block = doc.getBlock(id) as { attrs?: { zIndex?: number } } | null;
  return block?.attrs?.zIndex ?? -1;
}

/** The zIndex of each canvas element in the surface (in the children order). */
function zIndexesOf(doc: Doc, surface: string): number[] {
  return doc.getChildren(surface).map((id) => zOf(doc, id));
}

describe("setZOrder (the canvas z-order command)", () => {
  it("forward raises one step (the adjacent swap), one undo step", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b, c] = ids as [string, string, string];
    // Initial: a=1 (bottom), b=2, c=3 (top).
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);

    doc.setZOrder(a, "forward"); // a moves above b: b=1, a=2, c=3.
    expect(doc.getChildren(surface)).toEqual([b, a, c]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    // The element's own zIndex follows its position (a is now 2).
    expect(zOf(doc, a)).toBe(2);

    doc.undo();
    expect(doc.getChildren(surface)).toEqual([a, b, c]);
    expect(zOf(doc, a)).toBe(1);
  });

  it("back lowers one step", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b, c] = ids as [string, string, string];
    doc.setZOrder(c, "back"); // c moves below b: a=1, c=2, b=3.
    expect(doc.getChildren(surface)).toEqual([a, c, b]);
    expect(zOf(doc, c)).toBe(2);
    expect(zOf(doc, b)).toBe(3);
  });

  it("toFront raises to the top (the dense recalculation)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, , c] = ids as [string, string, string];
    doc.setZOrder(a, "toFront"); // a moves to the top: b=1, c=2, a=3.
    expect(doc.getChildren(surface)).toEqual([ids[1] as string, c, a]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(zOf(doc, a)).toBe(3);
  });

  it("toBack lowers to the bottom", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b, c] = ids as [string, string, string];
    doc.setZOrder(c, "toBack"); // c moves to the bottom: c=1, a=2, b=3.
    expect(doc.getChildren(surface)).toEqual([c, a, b]);
    expect(zOf(doc, c)).toBe(1);
  });

  it("a step at the top / bottom edge is a no-op (nothing is written)", () => {
    const doc = newDoc();
    const { ids } = surfaceWith(doc, ["rect", "ellipse"]);
    const [a, c] = ids as [string, string];
    const before = doc.encode();
    doc.setZOrder(c, "forward"); // c is at the top — no-op.
    expect(doc.encode()).toEqual(before);
    doc.setZOrder(a, "back"); // a is at the bottom — no-op.
    expect(doc.encode()).toEqual(before);
  });

  it("works over a connector (the same index space)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "connector"]);
    const [shape, connector] = ids as [string, string];
    doc.setZOrder(connector, "toBack"); // the connector moves below the shape.
    expect(doc.getChildren(surface)).toEqual([connector, shape]);
    expect(zOf(doc, connector)).toBe(1);
    expect(zOf(doc, shape)).toBe(2);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects a non-canvas target", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    expect(() => doc.setZOrder(p, "forward")).toThrow(InvalidOperationError);
  });

  it("is one wire update (one transact)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const a = ids[0] as string;
    let changes = 0;
    doc.onChange(() => {
      changes += 1;
    });
    doc.setZOrder(a, "toFront");
    expect(changes).toBe(1);
    expect(surface).toBeDefined();
  });
});

describe("the dense zIndex invariant (the strict validator)", () => {
  it("a dense 1..N set over the canvas elements is valid", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(ids.length).toBe(3);
  });

  it("rejects a non-dense zIndex (a gap)", () => {
    const doc = newDoc();
    const { ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    // A raw write that breaks the dense invariant (a gap).
    const targetId = ids[1] as string;
    doc.raw.transact(() => {
      const block = doc.raw.getMap("blocks").get(targetId) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("zIndex", 9);
    });
    const error = validateDoc(doc.toJSON()).find((e) => e.path === `blocks.${targetId}.attrs.zIndex`);
    expect(error?.message).toContain("dense");
  });

  it("rejects a mixed set (some with a zIndex, some without)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse"]);
    const a = ids[0] as string;
    // Drop the first element's zIndex (a mixed set).
    doc.raw.transact(() => {
      const block = doc.raw.getMap("blocks").get(a) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).delete("zIndex");
    });
    const error = validateDoc(doc.toJSON()).find((e) => e.path === `blocks.${a}.attrs.zIndex`);
    expect(error?.message).toContain("all carry a zIndex");
    expect(surface).toBeDefined();
  });

  it("a surface with no zIndex at all is the legacy form (valid)", () => {
    const doc = newDoc();
    const { ids } = surfaceWith(doc, ["rect", "ellipse"]);
    // Drop all the zIndex (the legacy form).
    for (const id of ids) {
      doc.raw.transact(() => {
        const block = doc.raw.getMap("blocks").get(id) as Y.Map<unknown>;
        (block.get("attrs") as Y.Map<unknown>).delete("zIndex");
      });
    }
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("the zIndex reconciliation (insert / move / remove)", () => {
  it("a new canvas element takes max + 1 (on top)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse"]);
    const [a, b] = ids as [string, string];
    const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    expect(doc.getChildren(surface)).toEqual([a, b, c]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(zOf(doc, c)).toBe(3);
  });

  it("a moveBlock within the surface keeps the zIndex dense", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b, c] = ids as [string, string, string];
    doc.moveBlock(a, surface, 3); // a moves to the end (the pre-move index 3): b=1, c=2, a=3.
    expect(doc.getChildren(surface)).toEqual([b, c, a]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a removal re-densifies the remaining zIndex (no gaps)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b] = ids as [string, string];
    doc.removeBlock(b); // remove the middle element.
    expect(doc.getChildren(surface)).toEqual([a, ids[2] as string]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a changeBlockType out of the z-order re-densifies the surface", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "ellipse", "rect"]);
    const [a, b, c] = ids as [string, string, string];
    doc.changeBlockType(a, "paragraph"); // a leaves the index (the attr falls out).
    expect(doc.getChildren(surface)).toEqual([a, b, c]); // the array position stands.
    expect(zOf(doc, a)).toBe(-1);
    expect(zIndexesOf(doc, surface)).toEqual([-1, 1, 2]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a changeBlockType into the z-order takes the array position's index", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const d = doc.insertBlock("divider", undefined, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    // a=1, d (the page type — no index), b=2.
    doc.changeBlockType(d, "shape", { variant: "rounded" });
    expect(doc.getChildren(surface)).toEqual([a, d, b]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]); // d stands at its array slot.
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a group stands in the same index (the setZOrder over the container)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const group = doc.insertBlock("group", { members: [a] }, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    // a=1, group=2, b=3.
    doc.setZOrder(group, "toFront");
    expect(doc.getChildren(surface)).toEqual([a, b, group]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});
