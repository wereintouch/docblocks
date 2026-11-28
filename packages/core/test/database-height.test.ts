import { describe, expect, it } from "vitest";

import { InvalidAttrsError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { BLOCK_REGISTRY, validateDoc } from "../src/schema";
import type { DatabaseBlock } from "../src/schema";

/**
 * The database block's `height` attr (the external-form view state):
 * an optional positive number in px. The data level checks the positivity
 * only (the auto height is the rendering floor, not a data bound); an
 * absent height stands the auto height. Additive over the v1 data.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

/** The strict validator on a single-block doc JSON (the block at `db`). */
const validate = (attrs: Record<string, unknown>): string[] => {
  const json = {
    v: 1,
    id: "r",
    title: "T",
    createdAt: CREATED_AT,
    blocks: {
      r: { type: "root", children: ["db"] },
      db: { type: "database", attrs: { tableId: "t1", ...attrs }, rows: {}, rowOrder: [] },
    },
  };
  return validateDoc(json).map((error) => error.message);
};

const readHeight = (doc: Doc, id: string): number | undefined => (doc.getBlock(id)! as DatabaseBlock).attrs.height;

describe("the height attr (the external-form view state)", () => {
  it("the registry declares the height as a positive number (no nullable / reset form)", () => {
    expect(BLOCK_REGISTRY.database.attrs?.height).toEqual({ kind: "number", positive: true });
  });

  it("the height is absent by default (the auto height stands)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });
    expect(readHeight(doc, db)).toBeUndefined();
  });

  it("the height round-trips over insertBlock / updateBlock / toJSON / fromJSON", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1", height: 320 });
    expect(readHeight(doc, db)).toBe(320);

    doc.updateBlock(db, { height: 480 });
    expect(readHeight(doc, db)).toBe(480);

    // One undo step reverts the height (the view state is the doc's data).
    doc.undo();
    expect(readHeight(doc, db)).toBe(320);

    // The JSON round-trip keeps the height.
    const json = JSON.parse(JSON.stringify(doc.toJSON()));
    expect(readHeight(fromJSON(json), db)).toBe(320);
  });

  it("a zero / negative / non-finite / non-number height is rejected (the doc stands)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    const db = doc.insertBlock("database", { tableId: "t1" });

    expect(() => doc.updateBlock(db, { height: 0 })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(db, { height: -10 })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(db, { height: Number.NaN })).toThrow(InvalidAttrsError);
    expect(() => doc.updateBlock(db, { height: "tall" as unknown as number })).toThrow(InvalidAttrsError);
    // No nullable form: null is rejected (the absent stand is the auto).
    expect(() => doc.updateBlock(db, { height: null as unknown as number })).toThrow(InvalidAttrsError);

    // The rejected patches leave the attrs untouched.
    expect(readHeight(doc, db)).toBeUndefined();
  });

  it("the insertBlock rejects an invalid height (the strict attrs guard)", () => {
    const doc: Doc = createDoc({ id: "doc-1", createdAt: CREATED_AT });
    expect(() => doc.insertBlock("database", { tableId: "t1", height: 0 })).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("database", { tableId: "t1", height: -1 })).toThrow(InvalidAttrsError);
  });

  it("the strict validator checks the height (the data-level positivity)", () => {
    expect(validate({ height: 320 })).toEqual([]);
    expect(validate({})).toEqual([]); // the absent height stands (the auto)
    expect(validate({ height: 0 })).not.toEqual([]);
    expect(validate({ height: "tall" })).not.toEqual([]);
  });
});
