// The commit's scope's pins: the subtree-scope (a page-block entry root)
// + the scope with a surface (the page view's filtered member). No DOM is
// involved — the commit is pure doc math.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { commitFlatDrag } from "../src/motion/reorder";

type TestDoc = ReturnType<typeof createDoc>;

/**
 * A master-like sequence for the subtree-scope pins: [h, p1, sub, s1, s2,
 * after] — `sub` (indent 0) is a page block, its derived segment
 * [sub, s1, s2] (s1/s2 at indent 1) a subtree entry root's scope; h, p1,
 * and after stand outside it (the container's sequence is longer than the
 * scope — the original silent no-op: the full sequence mapped against a
 * segment-sized visible order).
 */
function subtreeDoc(): {
  doc: TestDoc;
  root: BlockId;
  byName: Record<"h" | "p1" | "sub" | "s1" | "s2" | "after", BlockId>;
} {
  const doc = createDoc({ id: "doc-sub", createdAt: "2026-10-10T00:00:00.000Z" });
  const root = doc.meta.id;
  const byName = {} as Record<"h" | "p1" | "sub" | "s1" | "s2" | "after", BlockId>;
  const specs: Array<["h" | "p1" | "sub" | "s1" | "s2" | "after", number]> = [
    ["h", 0],
    ["p1", 0],
    ["sub", 0],
    ["s1", 1],
    ["s2", 1],
    ["after", 0],
  ];
  for (const [name, indent] of specs) {
    byName[name] = doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent: root });
  }
  return { doc, root, byName };
}

describe("commitFlatDrag over a subtree scope (a page-block entry root)", () => {
  it("commits an in-segment swap to the container's sequence, as one undo step", () => {
    const { doc, root, byName } = subtreeDoc();
    // The subtree entry root `sub`: the visible rows are its derived
    // segment [sub, s1, s2]. Drag s1 down below s2 (an in-segment swap).
    // The seam's neighbors: sub (0) before, s2 (1) after — the candidate
    // 1 (s2's indent) stands s1 at s2's level (its own indent — the
    // segment's internal order, not a real seam move... the swap keeps
    // s1 at 1 either way: candidate 1, the delta 0).
    const ok = commitFlatDrag(doc, byName.sub, byName.s1, [byName.sub, byName.s2, byName.s1], [], 1);
    expect(ok).toBe(true);
    // The commit lands in the CONTAINER's sequence (not the subtree root's
    // children — a page block is structurally childless): the swap is
    // inside the segment, the outside blocks stand, the indents stand.
    expect(doc.getChildren(root)).toEqual([byName.h, byName.p1, byName.sub, byName.s2, byName.s1, byName.after]);
    expect((doc.toJSON().blocks[byName.s1] as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect((doc.toJSON().blocks[byName.s2] as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    // One undo step: one command undoes the swap.
    doc.undo();
    expect(doc.getChildren(root)).toEqual([byName.h, byName.p1, byName.sub, byName.s1, byName.s2, byName.after]);
  });

  it("drops a stale visible order (the frozen rows are not the current segment) without a command", () => {
    const { doc, root, byName } = subtreeDoc();
    // A remote insert mid-drag grew the segment (a deeper block after s1)
    // while the local visible order froze at the pre-insert 3 rows: the
    // derived final order is not the current segment — a stale drop.
    doc.insertBlock("paragraph", { indent: 1 }, { parent: root, after: byName.s1 });
    const orderBefore = doc.getChildren(root);
    const canUndoBefore = doc.canUndo;
    const ok = commitFlatDrag(doc, byName.sub, byName.s1, [byName.sub, byName.s2, byName.s1], [], 1);
    expect(ok).toBe(false);
    expect(doc.getChildren(root)).toEqual(orderBefore);
    // Nothing was committed: no undo step added by the dropped move.
    expect(doc.canUndo).toBe(canUndoBefore);
  });
});

describe("commitFlatDrag over a scope with a surface (the page view's filtered member)", () => {
  /**
   * The page sequence with a surface in the root scope: [p1, surface, p2,
   * p3] — the surface (the canvas layer) stands in the container's sequence
   * without a visible row (the page view filters it out), so the visible
   * order is [p1, p2, p3] and the commit runs over the full scope.
   */
  function surfaceDoc(): {
    doc: TestDoc;
    root: BlockId;
    byName: Record<"p1" | "surface" | "p2" | "p3", BlockId>;
  } {
    const doc = createDoc({ id: "doc-surface", createdAt: "2026-10-10T00:00:00.000Z" });
    const root = doc.meta.id;
    const byName = {} as Record<"p1" | "surface" | "p2" | "p3", BlockId>;
    byName.p1 = doc.insertBlock("paragraph", undefined, { parent: root });
    byName.surface = doc.insertBlock("surface", undefined, { parent: root });
    byName.p2 = doc.insertBlock("paragraph", undefined, { parent: root });
    byName.p3 = doc.insertBlock("paragraph", undefined, { parent: root });
    return { doc, root, byName };
  }

  it("keeps the surface's slot when a block is dragged down (the canvas layer's position stands)", () => {
    const { doc, root, byName } = surfaceDoc();
    // Drag p1 below the surface (the visible order [p1, p2, p3] stands
    // [p2, p1, p3]): the visible rows stand around the surface in scope
    // order, so the rest keeps the surface's slot and the segment lands
    // before p2 — right behind the surface (a page gesture does not move
    // the canvas layer).
    const ok = commitFlatDrag(doc, root, byName.p1, [byName.p2, byName.p1, byName.p3], [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.surface, byName.p2, byName.p1, byName.p3]);
  });

  it("keeps the surface's slot when a block is dragged up (a no-op stands the no-op's posture)", () => {
    const { doc, root, byName } = surfaceDoc();
    // The no-op drop (the head stands in place): the visible order stands
    // [p1, p2, p3] (the store's visible order) — the commit issues no
    // command (a surface before the head shifts the splice point off the
    // head's own scope index, so the check is the final order's stand).
    const canUndoBefore = doc.canUndo;
    const ok = commitFlatDrag(doc, root, byName.p1, [byName.p1, byName.p2, byName.p3], [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.p1, byName.surface, byName.p2, byName.p3]);
    // The no-op issues no write (the undo history stands — the capture is
    // pre-commit: the seed inserts already carry steps).
    expect(doc.canUndo).toBe(canUndoBefore);
  });

  it("stands the segment at the seam's level when the surface stands as the seam's neighbor", () => {
    const { doc, root, byName } = surfaceDoc();
    // Drag p3 to the front (the visible order [p3, p1, p2]): the seam's
    // only neighbor at the sequence's start is p1 (the surface stands no
    // seam information — the candidate 0 stands p3 at p1's level).
    const ok = commitFlatDrag(doc, root, byName.p3, [byName.p3, byName.p1, byName.p2], [], 0);
    expect(ok).toBe(true);
    // The surface keeps its scope slot: the segment lands before it, the
    // rest (p1, p2) keeps its order behind.
    expect(doc.getChildren(root)).toEqual([byName.p3, byName.p1, byName.surface, byName.p2]);
  });

  it("stands the trailing surface's slot when a block lands at the visible end", () => {
    const { doc, root, byName } = surfaceDoc();
    // Move the surface to the scope's end (the test's own data setup — the
    // page gesture does not do this): pre-move index = the sequence's
    // length. Drag p1 to the visible end (the visible order [p2, p3, p1]):
    // the visible end stands before the trailing surface (the segment does
    // not cross the canvas layer's slot).
    doc.moveBlock(byName.surface, root, 4);
    const ok = commitFlatDrag(doc, root, byName.p1, [byName.p2, byName.p3, byName.p1], [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.p2, byName.p3, byName.p1, byName.surface]);
  });
});
