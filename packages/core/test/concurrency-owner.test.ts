import { describe, expect, it } from "vitest";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

/**
 *acceptance: the block owner is a single CRDT-resolved `parent` field
 * (set by insert/move/load), so any two concurrent moves of the same block
 * resolve to exactly one owner — not a duplicate reference in two
 * containers' children arrays. Deleting the losing container preserves the
 * block and its text; the final state reloads as a valid snapshot.
 */
describe("concurrent moves keep a single owner", () => {
  const seed = (id: string): { a: Doc; blockId: string } => {
    const a = createDoc({ id });
    const blockId = a.insertBlock("paragraph");
    a.insertText(blockId, 0, "moved block");
    return { a, blockId };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());
  const exchange = (a: Doc, b: Doc): void => {
    const aBytes = a.encode();
    const bBytes = b.encode();
    a.applyUpdate(bBytes);
    b.applyUpdate(aBytes);
  };

  /** The container ids (from the JSON children) that list `blockId`. */
  const ownersOf = (json: DocJSON, blockId: string): string[] =>
    Object.entries(json.blocks)
      .filter(([, block]) => ((block as { children?: readonly string[] }).children ?? []).includes(blockId))
      .map(([parentId]) => parentId);

  /** The two sibling container ids (surfaces: the page-set containers a page block can move into). */
  const twoSurfaces = (a: Doc) => {
    const surfaceA = a.insertBlock("surface");
    const surfaceB = a.insertBlock("surface");
    return { surfaceA, surfaceB };
  };

  it("a block has exactly one owner after two concurrent moves", () => {
    const { a, blockId } = seed("owner-single");
    const { surfaceA, surfaceB } = twoSurfaces(a);
    const b = fork(a);
    a.moveBlock(blockId, surfaceA, 0);
    b.moveBlock(blockId, surfaceB, 0);
    exchange(a, b);
    const owners = ownersOf(a.toJSON(), blockId);
    expect(owners).toHaveLength(1);
    expect([surfaceA, surfaceB]).toContain(owners[0]!);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("deleting the losing container preserves the block and its text", () => {
    const { a, blockId } = seed("owner-keep");
    const { surfaceA, surfaceB } = twoSurfaces(a);
    const b = fork(a);
    a.moveBlock(blockId, surfaceA, 0);
    b.moveBlock(blockId, surfaceB, 0);
    exchange(a, b);
    const owner = ownersOf(a.toJSON(), blockId)[0]!;
    const loser = owner === surfaceA ? surfaceB : surfaceA;
    a.removeBlock(loser);
    expect(a.getBlock(blockId)).not.toBeNull();
    expect(a.getText(blockId)).toBe("moved block");
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("deleting the winning container removes the block", () => {
    const { a, blockId } = seed("owner-drop");
    const { surfaceA, surfaceB } = twoSurfaces(a);
    const b = fork(a);
    a.moveBlock(blockId, surfaceA, 0);
    b.moveBlock(blockId, surfaceB, 0);
    exchange(a, b);
    const owner = ownersOf(a.toJSON(), blockId)[0]!;
    a.removeBlock(owner);
    expect(a.getBlock(blockId)).toBeNull();
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("undo of a move restores the block to its original container", () => {
    const { a, blockId } = seed("owner-undo");
    const surfaceA = a.insertBlock("surface");
    a.moveBlock(blockId, surfaceA, 0);
    expect(ownersOf(a.toJSON(), blockId)).toEqual([surfaceA]);
    a.undo();
    // Back at the top level: the root (id === the doc id) lists it.
    expect(ownersOf(a.toJSON(), blockId)).toEqual([a.toJSON().id]);
    expect(a.getText(blockId)).toBe("moved block");
  });

  it("the merged state reloads as a valid snapshot with one owner", () => {
    const { a, blockId } = seed("owner-reload");
    const { surfaceA, surfaceB } = twoSurfaces(a);
    const b = fork(a);
    a.moveBlock(blockId, surfaceA, 0);
    b.moveBlock(blockId, surfaceB, 0);
    exchange(a, b);
    const reloaded = loadDoc(a.encode());
    const json = reloaded.toJSON();
    expect(validateDoc(json)).toEqual([]);
    expect(ownersOf(json, blockId)).toHaveLength(1);
    expect(reloaded.getText(blockId)).toBe("moved block");
    expect(json).toEqual(a.toJSON());
  });
});
