// The flat-row drag commit math (the motion view): `commitFlatDrag` maps the
// final VISIBLE order back to the full sequence (a collapsed item's hidden
// segment rows reinsert after their collapsed item) and issues the range
// move of the dragged block's derived subtree plus the seam's indent
// assignment (the head stands at the seam's candidate — the neighbor's
// indent, never its own for a real move — the segment shifts by the delta).
// No DOM is involved — the commit and the seam rule are pure doc math.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { commitFlatDrag, dropCandidateIndent } from "../src/motion/reorder";

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

/** The block's indent attr (absent is 0). */
function indentOf(doc: TestDoc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" ? indent : 0;
}

describe("commitFlatDrag", () => {
  it("moves a block's derived segment up, as one contiguous range", () => {
    const { doc, root, byName } = seededDoc();
    // Drag c (with c1) up, before b. The seam's only neighbor at the
    // sequence's start is a (indent 0) — the candidate 0 matches.
    const ok = commitFlatDrag(
      doc,
      root,
      byName.c,
      [byName.c, byName.c1, byName.a, byName.b, byName.b1, byName.d],
      [],
      0
    );
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.c, byName.c1, byName.a, byName.b, byName.b1, byName.d]);
    // The segment's internal order and the relative structure stand (the
    // indents shift by the delta — 0 here, the head stood at the seam's
    // level already).
    const cJson = doc.toJSON().blocks[byName.c]!;
    const c1Json = doc.toJSON().blocks[byName.c1]!;
    expect((cJson as { attrs?: { indent?: number } }).attrs?.indent).toBe(0);
    expect((c1Json as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });

  it("moves a multi-item segment down, before a following block", () => {
    const { doc, root, byName } = seededDoc();
    // Drag b (with b1) down, before d (after c's segment). The seam's
    // neighbors: c1 (indent 1) before, d (indent 0) after — the candidate
    // 0 stands the head at d's level (the pointer over d, or the gap's
    // upper half).
    const ok = commitFlatDrag(
      doc,
      root,
      byName.b,
      [byName.a, byName.c, byName.c1, byName.b, byName.b1, byName.d],
      [],
      0
    );
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.c, byName.c1, byName.b, byName.b1, byName.d]);
  });

  it("moves a multi-item segment to the end", () => {
    const { doc, root, byName } = seededDoc();
    // The seam at the sequence's end: the only neighbor is d (indent 0) —
    // the continuation's candidate.
    const ok = commitFlatDrag(
      doc,
      root,
      byName.b,
      [byName.a, byName.c, byName.c1, byName.d, byName.b, byName.b1],
      [],
      0
    );
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.c, byName.c1, byName.d, byName.b, byName.b1]);
  });

  it("stands a child segment head at the seam's level (its own indent is not a candidate)", () => {
    const { doc, root, byName } = seededDoc();
    // Drag b1 (a child of b, indent 1) up, before b itself: the seam's
    // neighbors are a and b (both indent 0) — the only candidate is 0.
    // The head's own indent (1) is NOT a variant (a real move takes the
    // seam's neighbor's indent) — b1 stands top-level, and its (absent)
    // followers would shift by the delta -1.
    const ok = commitFlatDrag(
      doc,
      root,
      byName.b1,
      [byName.a, byName.b1, byName.b, byName.c, byName.c1, byName.d],
      [],
      0
    );
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.a, byName.b1, byName.b, byName.c, byName.c1, byName.d]);
    expect(indentOf(doc, byName.b1)).toBe(0);
  });

  it("a no-op drop (the segment landed in place) issues no command", () => {
    const { doc, root, order, byName } = seededDoc();
    const ok = commitFlatDrag(doc, root, byName.b, order, [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("reinserts a collapsed item's hidden segment rows after it (the commit runs over the full sequence)", () => {
    const { doc, root, byName } = seededDoc();
    // c is collapsed: its hidden row c1 is unmounted. The visible sequence is
    // [a, b, b1, c, d]; drag a to the end. The seam's only neighbor is d
    // (indent 0).
    const visible = [byName.a, byName.b, byName.b1, byName.c, byName.d];
    const ok = commitFlatDrag(doc, root, byName.a, [byName.b, byName.b1, byName.c, byName.d, byName.a], [byName.c], 0);
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
    expect(commitFlatDrag(doc, root, byName.b, stale, [], 0)).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a stale drop (the rest was reordered mid-drag) and issues no command", () => {
    const { doc, root, order, byName } = seededDoc();
    // c1 stands after d in the final — a remote reorder of the rest (a
    // segment move of b's keeps the rest in order).
    const stale = [byName.a, byName.c, byName.b, byName.b1, byName.d, byName.c1];
    expect(commitFlatDrag(doc, root, byName.b, stale, [], 0)).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a drag of a block that vanished mid-drag", () => {
    const { doc, root, order } = seededDoc();
    expect(commitFlatDrag(doc, root, "vanished", order, [], 0)).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
  });

  it("drops a candidate that matches no seam neighbor (the own indent is not a variant)", () => {
    const { doc, root, order, byName } = seededDoc();
    // Drag b1 (indent 1) up, before b: the seam's neighbors are a and b
    // (both indent 0). The candidate 1 (b1's own current indent) matches
    // neither neighbor — a stale measurement (or a dropped own-indent
    // variant) — the stale drop's posture: no command, the order stands.
    const final = [byName.a, byName.b1, byName.b, byName.c, byName.c1, byName.d];
    const canUndoBefore = doc.canUndo;
    expect(commitFlatDrag(doc, root, byName.b1, final, [], 1)).toBe(false);
    expect(doc.getChildren(root)).toEqual(order);
    expect(doc.canUndo).toBe(canUndoBefore);
  });
});

describe("commitFlatDrag's seam indent assignment (the head stands at the seam's level, the segment shifts by the delta)", () => {
  /** x (0), b (0), b1 (1), b2 (2), a (0) — a two-deep chain to drag. */
  function deepDoc(): { doc: TestDoc; root: BlockId; byName: Record<"x" | "b" | "b1" | "b2" | "a", BlockId> } {
    const doc = createDoc({ id: "doc-deep", createdAt: "2026-10-10T00:00:00.000Z" });
    const root = doc.meta.id;
    const byName = {} as Record<"x" | "b" | "b1" | "b2" | "a", BlockId>;
    const specs: Array<["x" | "b" | "b1" | "b2" | "a", number]> = [
      ["x", 0],
      ["b", 0],
      ["b1", 1],
      ["b2", 2],
      ["a", 0],
    ];
    for (const [name, indent] of specs) {
      byName[name] = doc.insertBlock("paragraph", indent !== 0 ? { indent } : undefined, { parent: root });
    }
    return { doc, root, byName };
  }

  it("deepens: a segment head dragged into a deeper seam stands at the neighbor's indent, the followers shift by the delta", () => {
    const { doc, root, byName } = deepDoc();
    // Drag a (indent 0) into the gap between b (0) and b1 (1) — the
    // seam's deeper neighbor: the candidate 1 (b1's indent). The head
    // stands at 1 (b's child), the segment's followers (none) would shift
    // by +1.
    const final = [byName.x, byName.b, byName.a, byName.b1, byName.b2];
    const ok = commitFlatDrag(doc, root, byName.a, final, [], 1);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.x, byName.b, byName.a, byName.b1, byName.b2]);
    expect(indentOf(doc, byName.a)).toBe(1);
  });

  it("deepens a head with followers: the whole segment shifts by the delta, the relative structure stands", () => {
    const { doc, root, byName } = deepDoc();
    // Drag b's segment [b, b1, b2] (indents 0/1/2) to the end, after a:
    // the seam's only neighbor is a (indent 0) — the candidate 0, the
    // head's own indent: the delta 0, a pure move (the followers stand).
    const final = [byName.x, byName.a, byName.b, byName.b1, byName.b2];
    const ok = commitFlatDrag(doc, root, byName.b, final, [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.x, byName.a, byName.b, byName.b1, byName.b2]);
    expect(indentOf(doc, byName.b)).toBe(0);
    expect(indentOf(doc, byName.b1)).toBe(1);
    expect(indentOf(doc, byName.b2)).toBe(2);
  });

  it("shallows: a deep segment head dragged to a shallow seam stands at the neighbor's indent, the followers shift down by the delta", () => {
    const { doc, root, byName } = deepDoc();
    // Drag b1's segment [b1, b2] (indents 1/2) up, before b: the seam's
    // neighbors are x (0) and b (0) — the candidate 0. The head stands at
    // 0, the follower b2 shifts 2 -> 1 (the delta -1, the relative
    // structure stands).
    const final = [byName.x, byName.b1, byName.b2, byName.b, byName.a];
    const ok = commitFlatDrag(doc, root, byName.b1, final, [], 0);
    expect(ok).toBe(true);
    expect(doc.getChildren(root)).toEqual([byName.x, byName.b1, byName.b2, byName.b, byName.a]);
    expect(indentOf(doc, byName.b1)).toBe(0);
    expect(indentOf(doc, byName.b2)).toBe(1);
  });

  it("commits the move and the indents as one undo step (one transact)", () => {
    const { doc, root, byName } = deepDoc();
    const before = doc.toJSON();
    const final = [byName.x, byName.b1, byName.b2, byName.b, byName.a];
    const ok = commitFlatDrag(doc, root, byName.b1, final, [], 0);
    expect(ok).toBe(true);
    // One undo step restores the position and every indent at once.
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });
});

/**
 * The seam rule's measurement (the pointer's Y against the visible rows'
 * boxes): the pure half-of-the-seam math.
 */
describe("dropCandidateIndent", () => {
  // The rows: x (0) at 0-40, b (0) at 40-80, b1 (1) at 80-120, a (0) at
  // 120-160. The gaps (the margin zones) split at their centers.
  const rows = [
    { id: "x", top: 0, bottom: 40, indent: 0 },
    { id: "b", top: 40, bottom: 80, indent: 0 },
    { id: "b1", top: 80, bottom: 120, indent: 1 },
    { id: "a", top: 120, bottom: 160, indent: 0 },
  ];
  const segment = new Set(["x"]);

  it("stands the pointer's row's indent, over a non-segment row (both halves)", () => {
    expect(dropCandidateIndent(rows, 50, segment, "x")).toBe(0); // b's upper half
    expect(dropCandidateIndent(rows, 79, segment, "x")).toBe(0); // b's lower half
    expect(dropCandidateIndent(rows, 81, segment, "x")).toBe(1); // b1's upper half
    expect(dropCandidateIndent(rows, 119, segment, "x")).toBe(1); // b1's lower half
  });

  it("splits the gap's halves: the upper stands the row below's indent, the lower the row above's", () => {
    // A 20px margin zone between b1 (bottom 120) and a (top 140): the
    // halves split at the zone's center (130) — the upper half stands the
    // head before a (a's indent), the lower after b1 (b1's indent).
    const gapped = [
      { id: "b1", top: 80, bottom: 120, indent: 1 },
      { id: "a", top: 140, bottom: 180, indent: 0 },
    ];
    expect(dropCandidateIndent(gapped, 125, new Set(["h"]), "h")).toBe(0); // upper half: before a
    expect(dropCandidateIndent(gapped, 135, new Set(["h"]), "h")).toBe(1); // lower half: after b1
    // At the exact center the lower half wins (the seam's "after" side).
    expect(dropCandidateIndent(gapped, 130, new Set(["h"]), "h")).toBe(1);
  });

  it("stands the first standing row's indent above the first and the last's below the last", () => {
    // The edges stand against the STANDING rows (the segment's own rows
    // are the moving span, not the seam's neighbor): above x (the segment
    // at the sequence's start) the seam's only neighbor is b — the first
    // standing row.
    expect(dropCandidateIndent(rows, -1, segment, "x")).toBe(0); // above x (the first row)
    expect(dropCandidateIndent(rows, 161, segment, "x")).toBe(0); // below a (the last)
  });

  it("stands the first standing row's indent over the head's own first row (the sequence's start)", () => {
    // The head stands at the sequence's start (the drag's landing at the
    // front): the pointer above or over the head's own first row — the
    // seam's only neighbor is the first standing row, not the head.
    const headFirst = [
      { id: "x", top: 0, bottom: 40, indent: 1 },
      { id: "b", top: 40, bottom: 80, indent: 0 },
      { id: "b1", top: 80, bottom: 120, indent: 1 },
    ];
    expect(dropCandidateIndent(headFirst, 10, segment, "x")).toBe(0); // above x's own first row: the first standing row (b) stands at the seam
    expect(dropCandidateIndent(headFirst, 30, segment, "x")).toBe(0); // over x's own first row: the slot carries no seam information — the first standing row's indent
  });

  it("ignores the segment's own floating rows (the seam stands from the rows beneath)", () => {
    // The dragged row floats with the pointer — its box stands under the
    // pointer by construction: the seam stands from the non-segment rows
    // (the row the pointer stands over, or the nearest gap/edge).
    expect(dropCandidateIndent(rows, 20, segment, "x")).toBe(0); // over x's own box: the seam is beyond x — b (0) stands first below
    const withOwn = [...rows, { id: "x1", top: 40, bottom: 60, indent: 1 }];
    const ownSegment = new Set(["x", "x1"]);
    expect(dropCandidateIndent(withOwn, 45, ownSegment, "x")).toBe(0); // over the segment's own child's box: b (0) stands beneath
    // The pointer in the gap beyond the floating row: the nearest
    // non-own rows decide (b below, nothing above — the first's indent).
    expect(dropCandidateIndent(rows, 39, segment, "x")).toBe(0);
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
