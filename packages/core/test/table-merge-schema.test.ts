// The merged cells over the schema: the spans' round-trip, the read-path
// normalization (a stale / overlapping span clamps to what fits), and the
// strict validator's grid checks (bounds, overlaps, column bindings).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import { buildTableGrid, normalizeMerges, validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

interface TableCellSpec {
  columnId: string;
  colspan?: number;
  rowspan?: number;
}

/** A doc with one table of `columnIds` and the given rows' cells. */
function tableDoc(columnIds: string[], rows: TableCellSpec[][]): DocJSON {
  const blocks: Record<string, unknown> = {
    "doc-spans": { type: "root", children: ["t"] },
    t: { type: "table", columnOrder: columnIds, children: rows.map((_, row) => `row${row}`) },
  };
  const childrenByRow: Record<string, string[]> = {};
  rows.forEach((cells, row) => {
    const rowId = `row${row}`;
    childrenByRow[rowId] = cells.map((_, cell) => `c${row}-${cell}`);
    cells.forEach((cell, index) => {
      const cellId = `c${row}-${index}`;
      const attrs: Record<string, unknown> = { columnId: cell.columnId };
      if (cell.colspan !== undefined) attrs.colspan = cell.colspan;
      if (cell.rowspan !== undefined) attrs.rowspan = cell.rowspan;
      blocks[cellId] = { type: "table-cell", attrs };
    });
  });
  for (const [rowId, cells] of Object.entries(childrenByRow)) blocks[rowId] = { type: "table-row", children: cells };
  return { v: 1, id: "doc-spans", title: "", createdAt: CREATED_AT, blocks } as unknown as DocJSON;
}

const expectValid = (doc: unknown): void => expect(validateDoc(doc)).toEqual([]);

const expectError = (doc: unknown, path: string, needle: string): void => {
  const errors = validateDoc(doc);
  const hit = errors.find((error) => error.path === path && error.message.includes(needle));
  expect(hit, `expected an error at "${path}" mentioning "${needle}"; got ${JSON.stringify(errors)}`).toBeDefined();
};

describe("the spans' round-trip", () => {
  it("keeps the anchor's spans over toJSON / fromJSON", () => {
    const doc = createDoc({ id: "doc-spans", createdAt: CREATED_AT });
    const table = doc.insertBlock("table", { cols: 3 });
    const rowId = doc.insertBlock("table-row", undefined, { parent: table });
    for (let col = 0; col < 3; col += 1) doc.insertBlock("table-cell", undefined, { parent: rowId });
    const [firstCell] = doc.getChildren(rowId);
    doc.mergeTableCells(table, { row: 0, col: 0 }, { row: 0, col: 2 });

    const restored = fromJSON(doc.toJSON());
    const cell = restored.getBlock(firstCell!);
    expect(cell?.type).toBe("table-cell");
    expect(cell?.type === "table-cell" ? cell.attrs : undefined).toMatchObject({ colspan: 3 });
    expect(validateDoc(restored.toJSON())).toEqual([]);
  });
});

describe("normalizeMerges", () => {
  it("clamps a span running past the table's bounds", () => {
    const json = tableDoc(["a", "b"], [[{ columnId: "a", colspan: 5 }, { columnId: "b" }]]);
    const normalized = normalizeMerges(json);
    const cell = (normalized.blocks as Record<string, Record<string, unknown>>)["c0-0"]!;
    expect((cell.attrs as Record<string, unknown>).colspan).toBe(2);
  });

  it("clamps a span blocked by an earlier region (the occupied coordinate shrinks it)", () => {
    // The first anchor spans both rows of the first column; the second row's
    // cell bound to that column collides with the region, lands in the free
    // column, and its requested rowspan runs past the table — the
    // normalization drops it.
    const json = tableDoc(
      ["a", "b"],
      [[{ columnId: "a", rowspan: 2 }, { columnId: "b" }], [{ columnId: "a", rowspan: 2 }]]
    );
    const normalized = normalizeMerges(json);
    const blocks = normalized.blocks as Record<string, Record<string, unknown>>;
    expect((blocks["c0-0"]!.attrs as Record<string, unknown>).rowspan).toBe(2);
    expect((blocks["c1-0"]!.attrs as Record<string, unknown>).rowspan).toBeUndefined();
    // The bindings stay the corrupt stand's (the validator reports them).
    expect((blocks["c1-0"]!.attrs as Record<string, unknown>).columnId).toBe("a");
  });

  it("is idempotent and byte-stable on a normalized doc", () => {
    const json = tableDoc(["a", "b"], [[{ columnId: "a", colspan: 2 }], [{ columnId: "a" }, { columnId: "b" }]]);
    expect(normalizeMerges(json)).toBe(json);
    const once = normalizeMerges(tableDoc(["a", "b"], [[{ columnId: "a", colspan: 9 }]]));
    expect(normalizeMerges(once)).toBe(once);
  });

  it("drops the span keys that end up 1", () => {
    const json = tableDoc(["a"], [[{ columnId: "a", colspan: 1, rowspan: 4 }]]);
    const normalized = normalizeMerges(json);
    const attrs = (normalized.blocks as Record<string, Record<string, unknown>>)["c0-0"]!.attrs as Record<
      string,
      unknown
    >;
    expect(attrs.colspan).toBeUndefined();
    expect(attrs.rowspan).toBeUndefined();
  });

  it("normalizes a stale span over the fromJSON read", () => {
    const doc = fromJSON(tableDoc(["a", "b"], [[{ columnId: "a", colspan: 7 }]]));
    const table = doc.getChildren(doc.meta.id)[0]!;
    const [cell] = doc.getChildren(doc.getChildren(table)[0]!);
    const block = doc.getBlock(cell!);
    expect(block?.type === "table-cell" ? block.attrs : undefined).toMatchObject({ colspan: 2 });
  });

  it("normalizes a stale span over the snapshot load", () => {
    const source = createDoc({ id: "doc-spans", createdAt: CREATED_AT });
    const table = source.insertBlock("table", { cols: 2 });
    const rowId = source.insertBlock("table-row", undefined, { parent: table });
    // A short row (one cell of the two columns — the race-residue shape):
    // the stale span clamps to the table's free columns and stands valid.
    source.insertBlock("table-cell", undefined, { parent: rowId });
    const [firstCell] = source.getChildren(rowId);
    // A stale span in the snapshot (the escape hatch writes what a racing
    // merge could leave behind: a span past the table's width).
    const blocks = source.raw.getMap<Y.Map<unknown>>("blocks");
    const cellMap = blocks.get(firstCell!)!;
    const attrs = cellMap.get("attrs") as Y.Map<unknown>;
    attrs.set("colspan", 4);
    const merged = loadDoc(source.encode());

    const cell = merged.getBlock(firstCell!);
    expect(cell?.type === "table-cell" ? cell.attrs : undefined).toMatchObject({ colspan: 2 });
  });
});

describe("the strict validator's grid", () => {
  it("accepts a merged region and a short row over it", () => {
    expectValid(tableDoc(["a", "b", "c"], [[{ columnId: "a", colspan: 2 }, { columnId: "c" }], [{ columnId: "c" }]]));
    expectValid(tableDoc(["a", "b"], [[{ columnId: "a", rowspan: 2 }, { columnId: "b" }], [{ columnId: "b" }]]));
  });

  it("rejects a span running past the table's edge", () => {
    expectError(
      tableDoc(["a", "b"], [[{ columnId: "a", colspan: 3 }, { columnId: "b" }]]),
      "blocks.c0-0.attrs",
      "must stand inside the table"
    );
    expectError(tableDoc(["a"], [[{ columnId: "a", rowspan: 2 }]]), "blocks.c0-0.attrs", "must stand inside the table");
  });

  it("rejects two cells standing in the same column", () => {
    expectError(
      tableDoc(["a", "b"], [[{ columnId: "a", colspan: 2 }, { columnId: "b" }]]),
      "blocks.c0-1.attrs.columnId",
      "Two cells stand in the same column"
    );
  });

  it("rejects a columnId outside the table's column order", () => {
    expectError(
      tableDoc(["a", "b"], [[{ columnId: "zzz" }]]),
      "blocks.c0-0.attrs.columnId",
      "must stand a column of the table's columnOrder"
    );
  });

  it("rejects a non-integer / zero span at the attrs layer", () => {
    expectError(tableDoc(["a", "b"], [[{ columnId: "a", colspan: 0 }]]), "blocks.c0-0.attrs.colspan", "must be >= 1");
    expectError(
      tableDoc(["a", "b"], [[{ columnId: "a", rowspan: 1.5 }]]),
      "blocks.c0-0.attrs.rowspan",
      "must be an integer"
    );
  });
});

describe("buildTableGrid", () => {
  it("places the anchors by their bindings and returns the covered coordinates", () => {
    const { grid, clamped, collisions } = buildTableGrid(
      ["a", "b", "c"],
      [
        [
          { id: "x", columnId: "a", colspan: 2, rowspan: 2 },
          { id: "y", columnId: "c", colspan: 1, rowspan: 1 },
        ],
        [{ id: "z", columnId: "c", colspan: 1, rowspan: 1 }],
      ]
    );
    expect(clamped).toEqual([]);
    expect(collisions).toEqual([]);
    expect(grid.cellAt(0, 0)?.id).toBe("x");
    expect(grid.cellAt(1, 1)?.id).toBe("x");
    expect(grid.cellAt(1, 0)?.id).toBe("x");
    expect(grid.cellAt(0, 2)?.id).toBe("y");
    expect(grid.cellAt(1, 2)?.id).toBe("z");
    expect(grid.anchorsIn(0, 0, 1, 2).map((anchor) => anchor.id)).toEqual(["x", "y", "z"]);
  });

  it("reports a clamped span and a binding collision instead of throwing", () => {
    const clampedBuild = buildTableGrid(["a", "b"], [[{ id: "x", columnId: "a", colspan: 6, rowspan: 1 }]]);
    expect(clampedBuild.clamped.map((anchor) => anchor.id)).toEqual(["x"]);
    expect(clampedBuild.grid.cellAt(0, 1)?.id).toBe("x");

    // The cell bound to a column an earlier region covers lands in the free
    // slot (the corrupt input still draws).
    const collisionBuild = buildTableGrid(
      ["a", "b", "c"],
      [
        [
          { id: "x", columnId: "a", colspan: 2, rowspan: 1 },
          { id: "y", columnId: "b", colspan: 1, rowspan: 1 },
        ],
      ]
    );
    expect(collisionBuild.collisions).toEqual(["y"]);
    expect(collisionBuild.grid.cellAt(0, 1)?.id).toBe("x");
    expect(collisionBuild.grid.cellAt(0, 2)?.id).toBe("y");
  });
});
