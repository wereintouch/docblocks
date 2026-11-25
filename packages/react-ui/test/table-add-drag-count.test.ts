// The add chip's drag count over the live geometry: the step is the item the
// reader sees (a row's height, a column's width), and a removal walks the real
// sizes from the last one — one row's worth of drag removes exactly one row.
import { describe, expect, it } from "vitest";

import { addDragCount } from "../src/blocks/table/utils";

describe("the add drag's count over the live geometry", () => {
  it("counts the removal by the rows' own heights (one row's travel removes one row)", () => {
    // The rows stand 50 px each: a 50 px drag removes exactly one (the old
    // fixed 24 px step took two), a 100 px drag two.
    expect(addDragCount(4, -50, { sizes: [50, 50, 50, 50], fallback: 28 })).toBe(-1);
    expect(addDragCount(4, -100, { sizes: [50, 50, 50, 50], fallback: 28 })).toBe(-2);
    // The midpoints are the boundaries: half a row stands no removal.
    expect(addDragCount(4, -25, { sizes: [50, 50, 50, 50], fallback: 28 })).toBe(0);
    expect(addDragCount(4, -26, { sizes: [50, 50, 50, 50], fallback: 28 })).toBe(-1);
    // Varied heights: the walk stands each row's midpoint (the last row's 20 px,
    // then the 80 px row's 40 px past its start).
    expect(addDragCount(3, -60, { sizes: [20, 80, 40], fallback: 28 })).toBe(-1);
    expect(addDragCount(3, -81, { sizes: [20, 80, 40], fallback: 28 })).toBe(-2);
    // The floor keeps one row.
    expect(addDragCount(2, -500, { sizes: [50, 50], fallback: 28 })).toBe(-1);
    // The add's step is the last item's size (the fallback when unmeasured).
    expect(addDragCount(2, 100, { sizes: [120, 80], fallback: 100 })).toBe(1);
    expect(addDragCount(2, 160, { sizes: [120, 80], fallback: 100 })).toBe(2);
    expect(addDragCount(0, 100, { sizes: [], fallback: 28 })).toBe(4);
  });
});
