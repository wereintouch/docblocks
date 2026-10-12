import { describe, expect, it } from "vitest";

import { finalOrderAfterSlotDrop, moveTargetForReorder } from "../src/motion/reorder";

describe("moveTargetForReorder", () => {
  it("returns null when the order is unchanged", () => {
    expect(moveTargetForReorder(["a", "b", "c"], ["a", "b", "c"], "a")).toBeNull();
    expect(moveTargetForReorder(["a", "b"], ["b", "a"], "c")).toBeNull();
  });

  it("uses the pre-move index semantics (the mod+shift+arrow math)", () => {
    // One slot up: the final slot is the previous slot.
    expect(moveTargetForReorder(["a", "b", "c"], ["a", "c", "b"], "c")).toBe(1);
    // One slot down: removal shifts the target left, so the slot after the
    // next sibling.
    expect(moveTargetForReorder(["a", "b"], ["b", "a"], "a")).toBe(2);
    // Across several slots: the dragged block to the top and to the end.
    expect(moveTargetForReorder(["a", "b", "c"], ["c", "a", "b"], "c")).toBe(0);
    expect(moveTargetForReorder(["a", "b", "c"], ["b", "c", "a"], "a")).toBe(3);
  });

  it("returns null when the orders describe different block sets (a stale mid-drag order)", () => {
    expect(moveTargetForReorder(["a", "b", "c"], ["c", "a"], "c")).toBeNull();
    expect(moveTargetForReorder(["a", "b"], ["a", "x"], "b")).toBeNull();
  });
});

describe("finalOrderAfterSlotDrop", () => {
  it("moves the item to the named slot (a permutation of the old order)", () => {
    // To the top of the run: before the first item.
    expect(finalOrderAfterSlotDrop(["a", "b", "c"], "c", "a", "before")).toEqual(["c", "a", "b"]);
    // To the end of the run: after the last item.
    expect(finalOrderAfterSlotDrop(["a", "b", "c"], "a", "c", "after")).toEqual(["b", "c", "a"]);
    // Across siblings: after b.
    expect(finalOrderAfterSlotDrop(["a", "b", "c", "d"], "d", "b", "after")).toEqual(["a", "b", "d", "c"]);
    expect(finalOrderAfterSlotDrop(["a", "b", "c", "d"], "a", "c", "before")).toEqual(["b", "a", "c", "d"]);
  });

  it("handles the run edges with a null anchor (before the first / after the last)", () => {
    expect(finalOrderAfterSlotDrop(["x", "a", "b", "c"], "c", null, "before")).toEqual(["c", "x", "a", "b"]);
    expect(finalOrderAfterSlotDrop(["x", "a", "b", "c"], "a", null, "after")).toEqual(["x", "b", "c", "a"]);
  });

  it("returns null for the own slots (the no-op drops)", () => {
    expect(finalOrderAfterSlotDrop(["a", "b", "c"], "b", "a", "after")).toBeNull();
    expect(finalOrderAfterSlotDrop(["a", "b", "c"], "b", "c", "before")).toBeNull();
    expect(finalOrderAfterSlotDrop(["a", "b"], "a", null, "before")).toBeNull();
    expect(finalOrderAfterSlotDrop(["a", "b"], "b", null, "after")).toBeNull();
  });

  it("returns null for a stale order (a remote update changed the children mid-drag)", () => {
    expect(finalOrderAfterSlotDrop(["a", "b", "c"], "c", "x", "before")).toBeNull();
    expect(finalOrderAfterSlotDrop(["a", "b"], "c", "a", "before")).toBeNull();
  });

  it("feeds moveTargetForReorder with the pre-move index (a full drop → commit chain)", () => {
    const old = ["a", "b", "c", "d"];
    // d above a: the final order puts d first, the pre-move target is 0.
    const final = finalOrderAfterSlotDrop(old, "d", "a", "before");
    expect(moveTargetForReorder(old, final ?? [], "d")).toBe(0);
    // a below c: the pre-move target is after c (3).
    const final2 = finalOrderAfterSlotDrop(old, "a", "c", "after");
    expect(moveTargetForReorder(old, final2 ?? [], "a")).toBe(3);
  });
});
