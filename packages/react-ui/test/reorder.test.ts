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

  it("a move that lands a non-text block at the sequence's end stands the trailing paragraph (one undo step)", () => {
    const { doc, root, byName } = seededDoc();
    // Stand a non-text block in the sequence: d (the last, a paragraph) is
    // replaced by a divider after a (the type change would lose the
    // content — the commands reject it; the removal + insertion stands it).
    const dividerId = doc.insertBlock("divider", undefined, { parent: root, after: byName.a });
    doc.removeBlock(byName.d);
    // Drag the divider to the sequence's end: the move commits and the tail
    // guarantee stands the empty editable paragraph (the non-text last
    // block stands no caret home) in the same transact.
    const ok = commitFlatDrag(
      doc,
      root,
      dividerId,
      [byName.a, byName.b, byName.b1, byName.c, byName.c1, dividerId],
      [],
      1
    );
    expect(ok).toBe(true);
    const children = doc.getChildren(root);
    const last = children[children.length - 1]!;
    expect(doc.getBlock(last)?.type).toBe("paragraph");
    expect(children).toEqual([byName.a, byName.b, byName.b1, byName.c, byName.c1, dividerId, last]);
    // One undo step for the whole commit (the move + the guarantee's insert):
    // the divider slides back and the inserted tail is gone in one step.
    doc.undo();
    expect(doc.getChildren(root)).toEqual([byName.a, dividerId, byName.b, byName.b1, byName.c, byName.c1]);
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
