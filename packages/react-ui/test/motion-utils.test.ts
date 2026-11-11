// The pure drag helpers over the no-DOM environment: the global
// TouchEvent is absent here, standing the no-touch Safari (the desktop
// Safari on macOS) — the pointerYOf's touch's stand must not touch the
// global at all.
import { describe, expect, it } from "vitest";

import { pointerYOf } from "../src/motion/utils";

describe("pointerYOf (the drag's pointer Y)", () => {
  it("stands the pointer/mouse event's clientY without the TouchEvent global", () => {
    expect(pointerYOf({ clientY: 123 } as PointerEvent)).toBe(123);
    expect(pointerYOf({ clientY: 45.5 } as MouseEvent)).toBe(45.5);
  });

  it("stands the touch release's last changed touch's clientY (the duck-typed stand)", () => {
    const event = {
      changedTouches: [{ clientY: 10 }, { clientY: 55.5 }],
    } as unknown as TouchEvent;
    expect(pointerYOf(event)).toBe(55.5);
  });

  it("returns null over the touch event with the empty changed touches", () => {
    expect(pointerYOf({ changedTouches: [] } as unknown as TouchEvent)).toBeNull();
  });
});
