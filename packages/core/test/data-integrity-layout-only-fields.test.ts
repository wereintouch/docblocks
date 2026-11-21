import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";

describe("the layout-only fields stand out of the JSON export", () => {
  // The 'parent' field (the block's owner — the CRDT-resolved stand of a
  // concurrent move) is Yjs-layout-only: it never reaches the JSON (the
  // reader derives it from the tree). The export must not leak it into any
  // block (a stray key would pass the validator — the validator has no
  // closed set of block keys — so the stand is the export's own).
  it("the 'parent' field stands absent from every block's JSON (the nested stands included)", () => {
    const d = createDoc({ id: "no-parent" });
    const p = d.insertBlock("paragraph");
    d.insertText(p, 0, "top");
    const list = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(list, 0, "nested");
    const table = d.insertBlock("table", { cols: 1 });
    d.insertTableRow(table);
    const json = d.toJSON();
    expect(Object.keys(json.blocks).length).toBeGreaterThan(4); // root + the blocks above + the table's row / cell
    for (const block of Object.values(json.blocks)) {
      expect(Object.hasOwn(block, "parent"), `the block "${block.type}" leaks the layout-only parent`).toBe(false);
    }
  });
});
