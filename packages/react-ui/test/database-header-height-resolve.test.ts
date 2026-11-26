// @vitest-environment node
// The header-row height's stands: the two-level resolution (the block's own
// attr over the table section's value) and the drag's clamp (the auto height
// is the floor, the generous ceiling bounds the drag).
import { describe, expect, it } from "vitest";

import { clampDatabaseHeaderHeight, resolveDatabaseHeaderHeight } from "../src/database/grid/header-height";

describe("the header-row height's resolution (the block attr over the section value)", () => {
  it("the block's own attr wins over the section's value", () => {
    expect(resolveDatabaseHeaderHeight(96, 120)).toBe(96);
  });

  it("the section's value stands over a block without its own attr", () => {
    expect(resolveDatabaseHeaderHeight(undefined, 120)).toBe(120);
  });

  it("the block's attr stands without a section value", () => {
    expect(resolveDatabaseHeaderHeight(96, undefined)).toBe(96);
  });

  it("the absent stand keeps the auto height", () => {
    expect(resolveDatabaseHeaderHeight(undefined, undefined)).toBeUndefined();
  });
});

describe("the header-row height's clamp (the auto height is the floor)", () => {
  it("a height above the auto height stands as requested", () => {
    expect(clampDatabaseHeaderHeight(120, 34)).toBe(120);
  });

  it("a height below the auto height clamps up to it", () => {
    expect(clampDatabaseHeaderHeight(20, 34)).toBe(34);
  });

  it("an unmeasured auto height (no layout in the runtime) stands the one-line floor", () => {
    expect(clampDatabaseHeaderHeight(10, 0)).toBe(28);
  });

  it("the drag's ceiling bounds a runaway height", () => {
    expect(clampDatabaseHeaderHeight(2000, 0)).toBe(600);
  });

  it("a fractional height rounds to whole pixels", () => {
    expect(clampDatabaseHeaderHeight(90.6, 0)).toBe(91);
  });
});
