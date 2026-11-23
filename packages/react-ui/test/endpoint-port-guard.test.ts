// The connector endpoint's port guard over the wire data (the lenient
// render posture): a port name outside the known set — including the
// prototype keys the lenient reader keeps as-is — stands the zero normal,
// never the NaN geometry (the lookup must not follow the prototype chain).
import { describe, expect, it } from "vitest";

import type { CanvasRef } from "docblocks-core";

import { endpointPointOf } from "../src/canvas/geometry";

describe("endpointPointOf's port guard (the wire data's stand)", () => {
  it("stands the zero normal over an unknown free-point port", () => {
    for (const port of ["no-such-port", "constructor", "toString", "hasOwnProperty", "__proto__"] as const) {
      const ref = { x: 0, y: 0, port: port as CanvasRef["port"] };
      expect(endpointPointOf(ref, [], {}, { x: 0, y: 1 })).toEqual({ x: 0, y: 0, nx: 0, ny: 0 });
    }
  });
});
