import { describe, expect, it } from "vitest";

import { diffTexts, rebaseOffset } from "../src/editing/text-diff";

describe("diffTexts", () => {
  it("returns null for equal texts", () => {
    expect(diffTexts("", "")).toBeNull();
    expect(diffTexts("hello", "hello")).toBeNull();
  });

  it("inserts at the start, middle, and end", () => {
    expect(diffTexts("bc", "abc")).toEqual({ from: 0, deleteLen: 0, inserted: "a" });
    expect(diffTexts("ac", "abc")).toEqual({ from: 1, deleteLen: 0, inserted: "b" });
    expect(diffTexts("ab", "abc")).toEqual({ from: 2, deleteLen: 0, inserted: "c" });
  });

  it("deletes at the start, middle, and end", () => {
    expect(diffTexts("abc", "bc")).toEqual({ from: 0, deleteLen: 1, inserted: "" });
    expect(diffTexts("abc", "ac")).toEqual({ from: 1, deleteLen: 1, inserted: "" });
    expect(diffTexts("abc", "ab")).toEqual({ from: 2, deleteLen: 1, inserted: "" });
  });

  it("replaces a middle region", () => {
    expect(diffTexts("aXbYc", "aXYZc")).toEqual({ from: 2, deleteLen: 2, inserted: "YZ" });
    expect(diffTexts("aXYZc", "ac")).toEqual({ from: 1, deleteLen: 3, inserted: "" });
  });

  it("keeps the common prefix and suffix of a replacement", () => {
    expect(diffTexts("the quick fox", "the slow fox")).toEqual({ from: 4, deleteLen: 5, inserted: "slow" });
  });

  it("handles one side empty", () => {
    expect(diffTexts("", "abc")).toEqual({ from: 0, deleteLen: 0, inserted: "abc" });
    expect(diffTexts("abc", "")).toEqual({ from: 0, deleteLen: 3, inserted: "" });
  });
});

describe("rebaseOffset", () => {
  it("is unchanged when the delta starts after the offset", () => {
    const delta = diffTexts("hello world", "hello brave world")!;
    expect(rebaseOffset(0, delta)).toBe(0);
    expect(rebaseOffset(4, delta)).toBe(4);
  });

  it("an insertion exactly at the offset does not move it; a later offset shifts", () => {
    const delta = diffTexts("abc", "abXc")!;
    expect(rebaseOffset(2, delta)).toBe(2);
    expect(rebaseOffset(3, delta)).toBe(4);
  });

  it("a deletion covering the caret keeps it at the deletion start", () => {
    const delta = diffTexts("abXc", "abc")!;
    expect(rebaseOffset(2, delta)).toBe(2);
    expect(rebaseOffset(3, delta)).toBe(2);
    expect(rebaseOffset(1, delta)).toBe(1);
    // The caret inside a deleted span collapses to the deletion start.
    const wide = diffTexts("abcdef", "abf")!;
    expect(wide).toEqual({ from: 2, deleteLen: 3, inserted: "" });
    expect(rebaseOffset(3, wide)).toBe(2);
    expect(rebaseOffset(4, wide)).toBe(2);
  });

  it("maps the old text end across a change", () => {
    const delta = diffTexts("abc", "abcdX")!;
    // An insertion at the old end does not move the offset at that position.
    expect(rebaseOffset(3, delta)).toBe(3);
    const deleteDelta = diffTexts("abcd", "ab")!;
    expect(rebaseOffset(4, deleteDelta)).toBe(2);
  });

  it("combines insert and delete lengths for a replace", () => {
    const delta = diffTexts("abXc", "abYZc")!;
    expect(delta).toEqual({ from: 2, deleteLen: 1, inserted: "YZ" });
    expect(rebaseOffset(1, delta)).toBe(1); // before the region: unchanged
    expect(rebaseOffset(2, delta)).toBe(2); // at the region start: the replacement starts after it
    expect(rebaseOffset(3, delta)).toBe(4); // the trailing "c" shifts
  });
});
