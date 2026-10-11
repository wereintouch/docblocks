import { describe, expect, it } from "vitest";

import type { Selection } from "../src/core";
import { presenceSelectionOf } from "../src/sync";

/**
 * presenceSelectionOf: the wire mapping of a view selection. Pure
 * function — all four Selection shapes, caret vs range, the blocks chain
 * copied only when present and non-empty, UX-only fields dropped, input
 * untouched.
 */

describe("presenceSelectionOf", () => {
  it("a none selection maps to null (nothing travels the wire)", () => {
    expect(presenceSelectionOf({ kind: "none" })).toBeNull();
  });

  it("a caret maps to a single point, even when a chain and reverse are set", () => {
    const selection: Selection = {
      kind: "text",
      from: { blockId: "b1", offset: 3 },
      to: null,
      blocks: ["b1"],
      reverse: true,
    };
    expect(presenceSelectionOf(selection)).toEqual({ blockId: "b1", offset: 3 });
  });

  it("a range maps to from/to and copies the blocks chain when present", () => {
    const selection: Selection = {
      kind: "text",
      from: { blockId: "b1", offset: 0 },
      to: { blockId: "b3", offset: 5 },
      blocks: ["b1", "b2", "b3"],
      reverse: true,
    };
    expect(presenceSelectionOf(selection)).toEqual({
      from: { blockId: "b1", offset: 0 },
      to: { blockId: "b3", offset: 5 },
      blocks: ["b1", "b2", "b3"],
    });
  });

  it("a range without a chain (or with an empty one) carries no blocks key", () => {
    expect(
      presenceSelectionOf({
        kind: "text",
        from: { blockId: "b1", offset: 0 },
        to: { blockId: "b1", offset: 4 },
      })
    ).toEqual({
      from: { blockId: "b1", offset: 0 },
      to: { blockId: "b1", offset: 4 },
    });
    const empty: Selection = {
      kind: "text",
      from: { blockId: "b1", offset: 0 },
      to: { blockId: "b2", offset: 1 },
      blocks: [],
    };
    expect(presenceSelectionOf(empty)).not.toHaveProperty("blocks");
  });

  it("a blocks selection maps to its ids; the anchor is UX-only", () => {
    const selection: Selection = { kind: "blocks", ids: ["b2", "b1", "b3"], anchorId: "b1" };
    const mapped = presenceSelectionOf(selection);
    expect(mapped).toEqual({ blocks: ["b2", "b1", "b3"] });
    expect(mapped).not.toHaveProperty("anchorId");
  });

  it("never mutates or aliases the input", () => {
    const range = {
      kind: "text" as const,
      from: { blockId: "b1", offset: 0 },
      to: { blockId: "b2", offset: 1 },
      blocks: ["b1", "b2"],
    };
    const rangeOut = presenceSelectionOf(range) as { blocks: string[] };
    expect(rangeOut.blocks).not.toBe(range.blocks);
    range.blocks.push("b9");
    expect(rangeOut.blocks).toEqual(["b1", "b2"]);

    const ids: string[] = ["b2", "b1"];
    const blocks = { kind: "blocks" as const, ids, anchorId: "b2" };
    const blocksOut = presenceSelectionOf(blocks) as { blocks: string[] };
    expect(blocksOut.blocks).not.toBe(ids);
    ids.push("b3");
    expect(blocksOut.blocks).toEqual(["b2", "b1"]);

    // The inputs themselves are untouched by the mapping.
    expect(range.blocks).toEqual(["b1", "b2", "b9"]);
    expect(blocks.ids).toEqual(["b2", "b1", "b3"]);
  });
});
