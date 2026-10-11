import { describe, expect, it } from "vitest";

import { moveTargetForReorder } from "../src/motion/reorder";

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
