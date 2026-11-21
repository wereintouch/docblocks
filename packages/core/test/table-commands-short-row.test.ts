import { describe, expect, it } from "vitest";

import { fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

/** A cell's attrs (undefined when the cell carries none). */
const cellAttrs = (doc: Doc, cellId: string) => {
  const block = doc.getBlock(cellId)!;
  return block.type === "table-cell" ? block.attrs : undefined;
};

describe("the table column commands", () => {
  /** The short-row doc: the concurrent row × column race residue (a row
   * with fewer cells than the columnOrder — the leading cell absent), the
   * cells bound by columnId. */
  const shortRowDoc = (): Doc => {
    const json: DocJSON = {
      v: 1,
      id: "d1",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        d1: { type: "root", children: ["t"] },
        t: {
          type: "table",
          columnOrder: ["cA", "cB", "cC"],
          attrs: { columnWidths: [100, 100, 100] },
          children: ["r1"],
        },
        r1: { type: "table-row", children: ["cellB", "cellC"] },
        cellB: { type: "table-cell", attrs: { columnId: "cB" }, content: [], children: [] },
        cellC: { type: "table-cell", attrs: { columnId: "cC" }, content: [], children: [] },
      },
    } as DocJSON;
    return fromJSON(json);
  };

  it("moveTableColumn over a short row stands by the columnId binding (no shift, no raw error)", () => {
    const doc = shortRowDoc();
    // Moving the column without a cell (cA) to the end: the positional scan
    // would move the foreign cellB and then hit a Yjs out-of-range op (a
    // raw "Length exceeded!"); the identity stand skips the row.
    expect(() => doc.moveTableColumn("t", 0, 3)).not.toThrow();
    const tableJson = doc.toJSON().blocks["t"]!;
    expect(tableJson).toMatchObject({ columnOrder: ["cB", "cC", "cA"] });
    expect(doc.getChildren("r1")).toEqual(["cellB", "cellC"]);
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // The append insert stands the clamp the same way (the unclamped
    // column count would be a Yjs out-of-range op over the short row).
    expect(() => doc.insertTableColumn("t")).not.toThrow();
    expect(doc.getChildren("r1")).toHaveLength(3);
  });

  it("moveTableColumn moves the bound column's own cell (the foreign cell stands put)", () => {
    const doc = shortRowDoc();
    // Move cB to the first position: the positional scan would move the
    // cell at position 0 (cellC's neighbor cellB is at 0 — the leading cell
    // absence shifts the positions), the identity stand moves cB's own
    // cell.
    doc.moveTableColumn("t", 1, 0);
    const tableJson = doc.toJSON().blocks["t"]!;
    expect(tableJson).toMatchObject({ columnOrder: ["cB", "cA", "cC"] });
    expect(doc.getChildren("r1")).toEqual(["cellB", "cellC"]);
    expect(cellAttrs(doc, "cellC")).toMatchObject({ columnId: "cC" });
    expect(validateDoc(doc.toJSON())).toEqual([]);
    // The round trip keeps the residue valid (the strict validator
    // tolerates the short row).
    const reloaded = fromJSON(doc.toJSON());
    expect(reloaded.toJSON()).toEqual(doc.toJSON());
  });

  it("removeTableColumn stands by the columnId binding (no foreign cell dies over a short row)", () => {
    const doc = shortRowDoc();
    // Remove cA (the column without a cell): the positional scan would
    // remove cells[0] (cellB — a foreign column's cell); the identity stand
    // skips the row (the column identity dies in the columnOrder).
    doc.removeTableColumn("t", 0);
    let tableJson = doc.toJSON().blocks["t"]!;
    expect(tableJson).toMatchObject({ columnOrder: ["cB", "cC"] });
    expect(doc.getChildren("r1")).toEqual(["cellB", "cellC"]);
    // Remove cB (now at position 0): its own cell stands by the binding.
    doc.removeTableColumn("t", 0);
    tableJson = doc.toJSON().blocks["t"]!;
    expect(tableJson).toMatchObject({ columnOrder: ["cC"] });
    expect(doc.getChildren("r1")).toEqual(["cellC"]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("duplicateTableColumn copies the bound column's own cell (the foreign cell stands put)", () => {
    const doc = shortRowDoc();
    // Seed the source cell's content.
    const para = doc.insertBlock("paragraph", undefined, { parent: "cellB" });
    doc.insertText(para, 0, "source");
    // Duplicate cB (position 1): the positional scan would copy cells[1]
    // (cellC — a foreign column's cell); the identity stand copies cB's
    // own cell (the copy lands next to it, at the bound position + 1).
    doc.duplicateTableColumn("t", 1);
    const tableJson = doc.toJSON().blocks["t"]! as { columnOrder: string[] };
    const columnOrder = tableJson.columnOrder;
    expect(columnOrder).toHaveLength(4);
    expect(columnOrder.slice(0, 2)).toEqual(["cA", "cB"]);
    expect(columnOrder[3]).toBe("cC");
    const newColumnId = columnOrder[2]!;
    expect(newColumnId).not.toBe("cB");
    const cells = doc.getChildren("r1");
    expect(cells).toHaveLength(3);
    // The copy (position 1) re-binds to the fresh column and carries the
    // source content; cellC stands untouched at its position.
    const copy = cells[1]!;
    expect(cellAttrs(doc, copy)).toMatchObject({ columnId: newColumnId });
    const copyPara = doc.getChildren(copy)[0]!;
    expect(doc.getText(copyPara)).toBe("source");
    expect(doc.getChildren("r1")[2]).toBe("cellC");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("clearTableColumn / setTableColumnColor stand by the columnId binding (over a short row)", () => {
    const doc = shortRowDoc();
    // Color cB (position 1): the positional scan would color cells[1]
    // (cellC — a foreign column's cell); the identity stand colors cB's
    // own cell.
    doc.setTableColumnColor("t", 1, "#abcdef");
    expect(cellAttrs(doc, "cellB")).toMatchObject({ columnColor: "#abcdef" });
    expect(cellAttrs(doc, "cellC")?.columnColor).toBeUndefined();
    // Clear cB's content (the foreign cell's content stands intact).
    const cBPara = doc.insertBlock("paragraph", undefined, { parent: "cellB" });
    doc.insertText(cBPara, 0, "b");
    const cCPara = doc.insertBlock("paragraph", undefined, { parent: "cellC" });
    doc.insertText(cCPara, 0, "c");
    doc.clearTableColumn("t", 1);
    expect(doc.getText(cBPara)).toBe("");
    expect(doc.getText(cCPara)).toBe("c");
  });
});
