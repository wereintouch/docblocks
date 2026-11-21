// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { screenDeltaToCanvas } from "../src/canvas/viewport";

describe("screenDeltaToCanvas", () => {
  it("returns null below the 3px screen threshold", () => {
    expect(screenDeltaToCanvas(2, 0, 1)).toBeNull();
    expect(screenDeltaToCanvas(0, 2, 1)).toBeNull();
    expect(screenDeltaToCanvas(2, 2, 1)).toBeNull(); // hypot(2,2) < 3
  });

  it("divides the delta by the zoom (the pan cancels out)", () => {
    expect(screenDeltaToCanvas(40, -20, 2)).toEqual({ x: 20, y: -10 });
    expect(screenDeltaToCanvas(9, 12, 0.5)).toEqual({ x: 18, y: 24 });
  });
});
