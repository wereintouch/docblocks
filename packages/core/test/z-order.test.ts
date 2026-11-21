import { describe, expect, it } from "vitest";

import { InvalidOperationError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * The canvas z-order command (setZOrder) + the dense zIndex invariant. The
 * canvas elements (shape / connector / canvas-text / group / frame) of a
 * surface carry an explicit `zIndex` (dense 1..N, the children order's
 * mirror — 1 = bottom). The command reorders the surface's canvas elements
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
