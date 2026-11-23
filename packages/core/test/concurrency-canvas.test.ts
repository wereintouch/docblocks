import { describe, expect, it } from "vitest";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

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
    const { a, surface } = seedSurface("canvas-insert");
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
    const { a, surface } = seedSurface("canvas-rm");
    const first = a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    const b = fork(a);
    a.removeBlock(first);
    b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    exchange(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it("a concurrent reorder keeps a dense order and a valid snapshot", () => {
    const { a, surface } = seedSurface("canvas-reorder");
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
    const { a, surface } = seedSurface("canvas-reload");
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
