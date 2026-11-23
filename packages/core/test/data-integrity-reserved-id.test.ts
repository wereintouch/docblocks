import { describe, expect, it } from "vitest";

import { createDoc, fromJSON } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

describe("the reserved id stand", () => {
  // The id-keyed dictionaries (blocks / rows / cells) are plain objects in the
  // JSON format: an id that collides with an Object.prototype key would be
  // lost on the round trip (the __proto__ trap — the assignment reassigns the
  // prototype instead of creating an own key). The engine rejects the reserved
  // keys as ids at every input boundary (the commands + fromJSON) with a clear
  // error, so no id-keyed dictionary ever carries one.
  it("insertBlock rejects a reserved block id", () => {
    const d = createDoc({ id: "r" });
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(() => d.insertBlock("paragraph", undefined, { id })).toThrow(/reserved/);
    }
  });

  it("createDoc rejects a reserved document id", () => {
    for (const id of ["__proto__", "constructor", "toString"]) {
      expect(() => createDoc({ id })).toThrow(/reserved/);
    }
  });

  it("fromJSON rejects a reserved block id (the JSON.parse input stand)", () => {
    // A raw JSON string with __proto__ as an OWN block key: JSON.parse creates
    // it as an own data property (bypassing the __proto__ setter), so the
    // reader sees it and rejects it.
    const raw =
      '{"v":1,"id":"d","title":"t","createdAt":"2026-10-10T00:00:00.000Z","blocks":{"__proto__":{"type":"paragraph","content":[{"text":"x","marks":{}}]},"d":{"type":"root","children":["__proto__"]}}}';
    const parsed = JSON.parse(raw) as DocJSON;
    expect(Object.hasOwn(parsed.blocks, "__proto__")).toBe(true);
    let thrown: unknown;
    try {
      fromJSON(parsed);
    } catch (e) {
      thrown = e;
    }
    const message = thrown instanceof Error ? thrown.message : "";
    expect(message).toContain("reserved");
  });

  it("fromJSON rejects a reserved row and column id (the database dictionaries)", () => {
    // The rows (rowId -> cells) and cells (colId -> value) are id-keyed maps
    // too: a reserved row id or column id would be lost on the round trip.
    const raw =
      '{"v":1,"id":"d","title":"t","createdAt":"2026-10-10T00:00:00.000Z","blocks":{"d":{"type":"root","children":["db"]},"db":{"type":"database","attrs":{"columns":[{"id":"constructor","type":"text"}]},"rows":{"toString":{}},"rowOrder":["toString"]}}}';
    const errs = validateDoc(JSON.parse(raw) as DocJSON);
    const reserved = errs.filter((e) => e.message.includes("reserved"));
    // The reserved column id, the reserved row id (the rows key), and the
    // reserved row id (the rowOrder entry).
    expect(reserved).toHaveLength(3);
  });

  it("insertRow rejects a reserved row id (the generateId's stand)", () => {
    // The row id comes from the doc's generator (a custom generateId can
    // mint a reserved id): the command's own guard rejects it (the rows'
    // dictionary would lose the key on the JSON export).
    let minted = 0;
    const d = createDoc({ id: "r-row", generateId: () => (minted++ === 1 ? "__proto__" : `id${minted}`) });
    const db = d.insertBlock("database", { columns: [{ id: "c1", name: "C", type: "text" }] });
    expect(() => d.insertRow(db)).toThrow(/reserved/);
  });
});
