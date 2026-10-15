// The flat-row drag commit math (the motion view): `commitFlatDrag` maps the
// final VISIBLE order back to the full sequence (a collapsed item's hidden
// segment rows reinsert after their collapsed item) and issues the range
// move of the dragged block's derived subtree. No DOM is involved — the
// commit is pure doc math.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { commitFlatDrag } from "../src/motion/reorder";

type TestDoc = ReturnType<typeof createDoc>;

/**
 * The flat page: a sequence of top-level blocks, each with an optional
 * one-deep child (the derived segment). Returns the doc, the root id, and
 * the block ids in sequence order.
 */
function seededDoc(): {
  doc: TestDoc;
  root: BlockId;
  order: BlockId[];
  byName: Record<"a" | "b" | "b1" | "c" | "c1" | "d", BlockId>;
} {
  const doc = createDoc({ id: "doc-1", createdAt: "2026-10-10T00:00:00.000Z" });
  const root = doc.meta.id;
  const byName = {} as Record<"a" | "b" | "b1" | "c" | "c1" | "d", BlockId>;
  const specs: Array<["a" | "b" | "b1" | "c" | "c1" | "d", number, boolean]> = [
    // [name, indent, isListItem]
    ["a", 0, false],
    ["b", 0, true],
    ["b1", 1, true],
    ["c", 0, true],
    ["c1", 1, true],
    ["d", 0, false],
  ];
  for (const [name, indent, isList] of specs) {
    const id = isList
      ? doc.insertBlock("list-item", { list: "bullet", indent }, { parent: root })
      : doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent: root });
    byName[name] = id;
  }
  const order = [byName.a, byName.b, byName.b1, byName.c, byName.c1, byName.d];
  return { doc, root, order, byName };
}

describe("commitFlatDrag", () => {
  it("moves a block's derived segment up, as one contiguous range", () => {
    const { doc, root, byName } = seededDoc();
    // Drag c (with c1) up, before b.
    const ok = commitFlatDrag(doc, root, byName.c, [byName.c, byName.c1, byName.a, byName.b, byName.b1, byName.d], []);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.c, byName.c1, byName.a, byName.b, byName.b1, byName.d]);
    // The segment's internal order and indents stand (a reorder, not a re-nest).
    const cJson = doc.toJSON().blocks[byName.c]!;
    const c1Json = doc.toJSON().blocks[byName.c1]!;
    expect((cJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(0);
    expect((c1Json as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });

  it("moves a multi-item segment down, before a following block", () => {
    const { doc, root, byName } = seededDoc();
    // Drag b (with b1) down, before d (after c's segment).
    const ok = commitFlatDrag(doc, root, byName.b, [byName.a, byName.c, byName.c1, byName.b, byName.b1, byName.d], []);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.c, byName.c1, byName.b, byName.b1, byName.d]);
  });

  it("moves a multi-item segment to the end", () => {
    const { doc, root, byName } = seededDoc();
    const ok = commitFlatDrag(doc, root, byName.b, [byName.a, byName.c, byName.c1, byName.d, byName.b, byName.b1], []);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.c, byName.c1, byName.d, byName.b, byName.b1]);
  });

  it("moves a child segment under its own head's level (the head's indent leads)", () => {
    const { doc, root, byName } = seededDoc();
    // Drag b1 (a child of b) up, before b itself: b1 becomes top-level and b
    // follows it (b1's segment is just b1).
    const ok = commitFlatDrag(doc, root, byName.b1, [byName.a, byName.b1, byName.b, byName.c, byName.c1, byName.d], []);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.b1, byName.b, byName.c, byName.c1, byName.d]);
  });

  it("a no-op drop (the segment landed in place) issues no command", () => {
    const { doc, root, order, byName } = seededDoc();
    const ok = commitFlatDrag(doc, root, byName.b, order, []);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("reinserts a collapsed item's hidden segment rows after it (the commit runs over the full sequence)", () => {
    const { doc, root, byName } = seededDoc();
    // c is collapsed: its hidden row c1 is unmounted. The visible sequence is
    // [a, b, b1, c, d]; drag a to the end.
    const visible = [byName.a, byName.b, byName.b1, byName.c, byName.d];
    const ok = commitFlatDrag(doc, root, byName.a, [byName.b, byName.b1, byName.c, byName.d, byName.a], [byName.c]);
    expect(ok).toBe(true);
    // c1 reinserts after c (its collapsed owner), so the final is
    // [b, b1, c, c1, d, a].
    expect(doc.getChildren(root)).toEqual([byName.b, byName.b1, byName.c, byName.c1, byName.d, byName.a]);
    expect(visible).toEqual([byName.a, byName.b, byName.b1, byName.c, byName.d]);
  });

  it("drops a stale drop (the visible set changed mid-drag) and issues no command", () => {
    const { doc, root, order, byName } = seededDoc();
    // A final that names a ghost block (a remote insert the local order does
    // not know) is not the current sequence with the segment moved.
    const stale = [...order, "ghost"];
    expect(commitFlatDrag(doc, root, byName.b, stale, [])).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a stale drop (the rest was reordered mid-drag) and issues no command", () => {
    const { doc, root, order, byName } = seededDoc();
    // c1 stands after d in the final — a remote reorder of the rest (a
    // segment move of b's keeps the rest in order).
    const stale = [byName.a, byName.c, byName.b, byName.b1, byName.d, byName.c1];
    expect(commitFlatDrag(doc, root, byName.b, stale, [])).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a drag of a block that vanished mid-drag", () => {
    const { doc, root, order } = seededDoc();
    expect(commitFlatDrag(doc, root, "vanished", order, [])).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a jump-violating landing (a nested segment head to the sequence's start) as a no-op", () => {
    const { doc, root, order, byName } = seededDoc();
    // b1's indent is 1: making it the sequence's first block (the first
    // block's indent must be 0) is the core's indent-jump violation — the
    // transact rolls back, the commit drops with the stale drop's posture
    // (no command), the order stands (the motion view resyncs the rows
    // to the store).
    const canUndoBefore = doc.canUndo;
    const final = [byName.b1, byName.a, byName.b, byName.c, byName.c1, byName.d];
    expect(commitFlatDrag(doc, root, byName.b1, final, [])).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
    // Nothing was committed: no undo step added by the rejected move.
    expect(doc.canUndo).toBe(canUndoBefore);
  });
});

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
    const ok = commitFlatDrag(doc, byName.sub, byName.s1, [byName.sub, byName.s2, byName.s1], []);
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
    const ok = commitFlatDrag(doc, byName.sub, byName.s1, [byName.sub, byName.s2, byName.s1], []);
    expect(ok).toBe(false);
    expect(doc.getChildren(root)).toEqual(orderBefore);
    // Nothing was committed: no undo step added by the dropped move.
    expect(doc.canUndo).toBe(canUndoBefore);
  });
});
