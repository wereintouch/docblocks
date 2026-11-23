import { describe, expect, it } from "vitest";

import { InvalidOperationError, createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * The zIndex reconciliation (the sibling of z-order.test.ts): the insert /
 * move / remove / changeBlockType re-densification, the group + frame
 * parity, and the page-frame's no z-order.
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

  it("a frame stands in the same index (the setZOrder over the region marker)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    // a=1, frame=2, b=3 (the frame's slot over the children's order).
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    doc.setZOrder(frame, "toFront"); // the frame's move to the top: a=1, b=2, frame=3.
    expect(doc.getChildren(surface)).toEqual([a, b, frame]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(zOf(doc, frame)).toBe(3);
    doc.setZOrder(frame, "toBack"); // the frame's move to the bottom: frame=1, a=2, b=3.
    expect(doc.getChildren(surface)).toEqual([frame, a, b]);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a new frame takes max + 1 (on top, the elements' parity)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const frame = doc.insertBlock("frame", undefined, { parent: surface });
    expect(zOf(doc, frame)).toBe(2);
  });

  it("a page-frame block stands no z-order (the root context's stand)", () => {
    const doc = newDoc();
    doc.insertBlock("surface");
    const pageFrame = doc.insertBlock("frame", { frameId: "f-1" });
    expect(() => doc.setZOrder(pageFrame, "forward")).toThrow(InvalidOperationError);
  });
});
