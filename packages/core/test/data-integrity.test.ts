import { describe, expect, it } from "vitest";

import { type Doc, createDoc, loadDoc } from "../src/core";
import { validateDoc } from "../src/schema";

/**
 * The data-integrity suite (the sibling `data-integrity-*.test.ts` specs
 * stand the snapshot / reserved-key / layout / aliasing / embed-src /
 * cross-minor stances): the concurrent-edit invariants — two peers of the
 * same settled document edit in parallel and merge their full states, the
 * text stays intact under concurrent formatting (the text model is a single
 * Y.Text with mark attributes), a concurrently moved block keeps a single
 * CRDT-resolved owner, concurrent shape inserts into an empty surface yield
 * a reloadable snapshot, concurrent table column inserts keep the grid
 * consistent (the column set is the shared `columnOrder` array), concurrent
 * table column moves keep the column order unique (the `columnOrder`'s
 * first-occurrence deduplication over the read path), and concurrent inline
 * database row moves keep the row order unique (the `rowOrder`'s
 * first-occurrence deduplication picks the single position on every peer).
 *
 * The two peers load the settled state (`loadDoc` of the first peer's
 * bytes), so they are independent Y.Docs of the same content, not a
 * concurrent init.
 */

/** An independent second peer over the same content (settled-state load). */
const fork = (d: Doc): Doc => loadDoc(d.encode());

/** One bidirectional exchange: each side applies the other's full state. */
const merge = (a: Doc, b: Doc): void => {
  const ua = a.encode();
  const ub = b.encode();
  a.applyUpdate(ub);
  b.applyUpdate(ua);
};

/** A single paragraph seeded with the text `abcdef`. */
const seedParagraph = (): { a: Doc; id: string } => {
  const a = createDoc({ id: "pin" });
  const id = a.insertBlock("paragraph");
  a.insertText(id, 0, "abcdef");
  return { a, id };
};

describe("concurrent text and block edits keep the data valid", () => {
  it("concurrent formatting over a shared paragraph keeps the text intact", () => {
    const { a, id } = seedParagraph();
    const b = fork(a);
    a.setMark(id, 1, 4, { type: "bold" });
    b.setMark(id, 2, 5, { type: "italic" });
    merge(a, b);
    expect(a.getText(id)).toBe("abcdef");
    expect(b.getText(id)).toBe("abcdef");
  });

  it("concurrent moves of one block keep a single owner", () => {
    const { a, id } = seedParagraph();
    const surfaceA = a.insertBlock("surface");
    const surfaceB = a.insertBlock("surface");
    const b = fork(a);
    a.moveBlock(id, surfaceA, 0);
    b.moveBlock(id, surfaceB, 0);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent shape inserts into an empty surface yield a reloadable snapshot", () => {
    const a = createDoc({ id: "pin" });
    const surface = a.insertBlock("surface");
    const b = fork(a);
    a.insertBlock("shape", { variant: "rect" }, { parent: surface });
    b.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
    merge(a, b);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });

  it("concurrent table column inserts keep the grid consistent", () => {
    const a = createDoc({ id: "pin" });
    const table = a.insertBlock("table", { cols: 1 });
    a.insertTableRow(table);
    const b = fork(a);
    a.insertTableColumn(table, 1);
    b.insertTableColumn(table, 1);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent inline database row moves keep the order unique", () => {
    const a = createDoc({ id: "pin" });
    const database = a.insertBlock("database", {
      columns: [{ id: "value", name: "Value", type: "text" }],
    });
    const row = a.insertRow(database);
    a.insertRow(database);
    a.insertRow(database);
    const b = fork(a);
    a.moveRow(database, row, 3);
    b.moveRow(database, row, 2);
    merge(a, b);
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent table column moves keep the column order unique and reloadable", () => {
    const a = createDoc({ id: "pin" });
    const table = a.insertBlock("table", { cols: 4 });
    a.insertTableRow(table);
    const b = fork(a);
    a.moveTableColumn(table, 0, 2);
    b.moveTableColumn(table, 0, 3);
    merge(a, b);
    // The raw residue (both re-inserts) is deduplicated first-occurrence on
    // the read path: the export is valid in both postures and re-imports.
    const block = a.getBlock(table)!;
    if (block.type !== "table") throw new Error("unreachable: the table block");
    const orderA = block.columnOrder;
    expect(new Set(orderA).size).toBe(orderA.length);
    expect(validateDoc(a.toJSON())).toEqual([]);
    expect(() => loadDoc(a.encode())).not.toThrow();
  });
});
