import { describe, expect, it } from "vitest";

import { DocBlocksError, InvalidAttrsError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "tbl", createdAt: CREATED_AT });

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    expect(error).toBeInstanceOf(DocBlocksError);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

/** A `cols`-wide table with `rows` complete rows (empty cells). */
function buildTable(doc: Doc, cols: number, rows: number): { table: string; rowIds: string[] } {
  const table = doc.insertBlock("table", { cols });
  const rowIds: string[] = [];
  for (let r = 0; r < rows; r++) {
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    rowIds.push(row);
    for (let c = 0; c < cols; c++) doc.insertBlock("table-cell", undefined, { parent: row });
  }
  return { table, rowIds };
}

describe("the table schema extensions", () => {
  it("accepts the cell color attrs and the columnWidths array (round-trip)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 2);
    doc.setTableColumnColor(table, 0, "#112233");
    doc.setTableRowColor(table, rowIds[0]!, "#445566");
    doc.setTableColumnWidth(table, 1, 180);
    const json = doc.toJSON();
    const firstCell = doc.getChildren(rowIds[0]!)[0]!;
    const cell = doc.getBlock(firstCell)!;
    expect("attrs" in cell && cell.attrs).toMatchObject({ columnColor: "#112233", rowColor: "#445566" });
    expect(validateDoc(json)).toEqual([]);
    const revived = fromJSON(json);
    expect(revived.toJSON()).toEqual(json);
  });

  it("rejects a non-hex cell color and a bad columnWidths entry (strict validator)", () => {
    const doc = newDoc();
    const { table, rowIds } = buildTable(doc, 2, 1);
    expectThrows(() => doc.setTableRowColor(table, rowIds[0]!, "red"), InvalidAttrsError);
    expectThrows(() => doc.setTableColumnWidth(table, 0, 40), InvalidAttrsError);
    const json: DocJSON = {
      v: 1,
      id: "x",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        x: { type: "root", children: [table] },
        [table]: {
          type: "table",
          columnOrder: ["col0", "col1"],
          attrs: { columnWidths: [50] },
          children: [rowIds[0]!],
        },
        [rowIds[0]!]: { type: "table-row", children: ["c1", "c2"] },
        c1: { type: "table-cell", attrs: { columnId: "col0", rowColor: "nope" }, content: [], children: [] },
        c2: { type: "table-cell", attrs: { columnId: "col1" }, content: [], children: [] },
      },
    } as DocJSON;
    const paths = validateDoc(json).map((error) => error.path);
    expect(paths).toContain("blocks.c1.attrs.rowColor");
    expect(paths.filter((path) => path.endsWith(".attrs.columnWidths"))).toHaveLength(1);
  });
});
