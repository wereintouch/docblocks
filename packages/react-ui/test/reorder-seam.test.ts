// The commit's seam indent assignment (the head stands at the seam's
// level, the segment shifts by the delta): the deepens / shallows' pins
// over the two-deep chain's drag. No DOM is involved — the seam rule is
// pure doc math.
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { BlockId } from "docblocks-core";

import { commitFlatDrag } from "../src/motion/reorder";

type TestDoc = ReturnType<typeof createDoc>;

/** The block's indent attr (absent is 0). */
function indentOf(doc: TestDoc, id: BlockId): number {
  const block = doc.getBlock(id);
  if (block === null || !("attrs" in block)) return 0;
  const indent = (block.attrs as { indent?: unknown } | undefined)?.indent;
  return typeof indent === "number" ? indent : 0;
}

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
