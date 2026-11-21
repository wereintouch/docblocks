// The seam rule's measurement (dropCandidateIndent): the pointer's Y
// against the visible rows' boxes (the pure half-of-the-seam math).
// No DOM is involved.
import { describe, expect, it } from "vitest";

import { dropCandidateIndent } from "../src/motion/reorder";

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
