import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * The dense zIndex invariant + the bulk stand (the sibling of
 * z-order.test.ts): the strict validator's dense 1..N check, the legacy
 * form, and the large surface's bounded wire update.
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
    const targetId = ids[1] as string;
    // The read path derives the dense index, so the stored value is always
    // dense in a snapshot. The validator's dense check stands on a raw JSON
    // (a gap) — corrupt the snapshot directly and validate it.
    const json = doc.toJSON();
    const block = json.blocks[targetId] as unknown as { attrs: Record<string, unknown> };
    block.attrs.zIndex = 9;
    const error = validateDoc(json).find((e) => e.path === `blocks.${targetId}.attrs.zIndex`);
    expect(error?.message).toContain("dense");
  });

  it("rejects a mixed set (some with a zIndex, some without)", () => {
    const doc = newDoc();
    const { ids } = surfaceWith(doc, ["rect", "ellipse"]);
    const a = ids[0] as string;
    // Drop the first element's zIndex in the snapshot (a mixed set).
    const json = doc.toJSON();
    const block = json.blocks[a] as unknown as { attrs: Record<string, unknown> };
    delete block.attrs.zIndex;
    const error = validateDoc(json).find((e) => e.path === `blocks.${a}.attrs.zIndex`);
    expect(error?.message).toContain("all carry a zIndex");
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

describe("the bulk stand (the large surface's quadratic guard)", () => {
  it("a tail append over the large surface stands no mirror rewrite (the wire update stays bounded)", () => {
    const doc = newDoc();
    const surface = doc.insertBlock("surface");
    doc.transact(() => {
      for (let i = 0; i < 500; i += 1) {
        doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      }
    });
    // The dense's stand over the bulk (the 1..500 mirror).
    expect(zIndexesOf(doc, surface)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));
    // The wire delta's baseline (the state vector's stand — the full state
    // stands the `encodeUpdate`'s no-argument form).
    const baseline = Y.encodeStateVector(doc.raw);
    // The tail's append: the unchanged siblings' mirror stands no write
    // (the yjs's equal-value set's allocation stand — the bulk insert's
    // quadratic's guard). The delta carries the new block + the order
    // slot + the new element's index only.
    const added = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    expect(zIndexesOf(doc, surface)).toEqual(Array.from({ length: 501 }, (_, i) => i + 1));
    const delta = Y.encodeStateAsUpdate(doc.raw, baseline);
    expect(delta.length).toBeLessThan(4096);
    expect(zOf(doc, added)).toBe(501);
  });

  it("the derived read stands the in-flight order (the mid-transaction's parity)", () => {
    const doc = newDoc();
    const { surface, ids } = surfaceWith(doc, ["rect", "rect"]);
    // The mid-transaction read (the cache's invalidation over the
    // beforeTransaction): the in-flight append stands its position.
    let mid: unknown;
    doc.transact(() => {
      const third = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      mid = (doc.getBlock(third) as { attrs?: { zIndex?: number } } | null)?.attrs?.zIndex;
    });
    expect(mid).toBe(3);
    expect(zIndexesOf(doc, surface)).toEqual([1, 2, 3]);
    expect(ids.length).toBe(2);
  });
});
