import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";

describe("the snapshot's plain values stand no aliasing over the store", () => {
  // The read boundary must not hand out the CRDT store's own plain
  // values (a post-read mutation of the snapshot would corrupt the doc
  // outside any transaction — 0 change events, persisted through the
  // toJSON).
  it("the multi-select cell's snapshot stands no aliasing (the mutation stands no corruption)", () => {
    const doc = createDoc({ id: "d" });
    const db = doc.insertBlock("database", {
      columns: [{ id: "m", name: "M", type: "multi-select", options: ["a", "b"] }],
    });
    const row = doc.insertRow(db);
    doc.setCell(db, row, "m", ["a"]);
    let changes = 0;
    doc.onChange(() => changes++);
    const snapshot = doc.getBlock(db) as unknown as { rows?: Record<string, Record<string, unknown>> } | null;
    const cells = snapshot?.rows?.[row] as Record<string, unknown>;
    expect(cells.m).toEqual(["a"]);
    // The mutation over the snapshot (the aliasing stand): the store stands
    // untouched — no change event, the data stands.
    (cells.m as unknown[]).push("b");
    expect(changes).toBe(0);
    const after = doc.getBlock(db) as unknown as { rows?: Record<string, Record<string, unknown>> } | null;
    expect(after?.rows?.[row]?.m).toEqual(["a"]);
  });

  it("the shape's points tuples stand no aliasing (the mutation stands no corruption)", () => {
    const doc = createDoc({ id: "d" });
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock(
      "shape",
      {
        variant: "rect",
        points: [
          [0, 0],
          [10, 10],
        ],
      },
      { parent: surface }
    );
    const read = (id: string) =>
      (doc.getBlock(id) as unknown as { attrs?: { points?: number[][] } } | null)?.attrs?.points;
    const before = read(shape);
    expect(before).toEqual([
      [0, 0],
      [10, 10],
    ]);
    before?.[0]?.push(99);
    expect(read(shape)).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });
});
