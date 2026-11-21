import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type Doc, InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";

/** A single paragraph seeded with the text `abcdef`. */
const seedParagraph = (): { a: Doc; id: string } => {
  const a = createDoc({ id: "pin" });
  const id = a.insertBlock("paragraph");
  a.insertText(id, 0, "abcdef");
  return { a, id };
};

describe("snapshot and serialization", () => {
  it("an unknown major version is rejected on load", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").set("v", 2);
    expect(() => loadDoc(a.encode())).toThrow(/unsupported schema version 2/);
  });

  it("a v1 snapshot loads (the supported major stands)", () => {
    const { a } = seedParagraph();
    const restored = loadDoc(a.encode());
    expect(restored.toJSON().v).toBe(1);
    expect(restored.meta.v).toBe(1);
  });

  it("a missing schema version is rejected on load (before the content is interpreted)", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").delete("v");
    expect(() => loadDoc(a.encode())).toThrow(/missing or malformed schema version/);
  });

  it("a malformed schema version (a non-number) is rejected on load", () => {
    const { a } = seedParagraph();
    a.raw.getMap("meta").set("v", "1");
    expect(() => loadDoc(a.encode())).toThrow(/missing or malformed schema version/);
  });

  it("the JSON path: a v2 payload is rejected by the validator (no silent downgrade)", () => {
    const { a } = seedParagraph();
    const json = a.toJSON();
    let thrown: unknown;
    try {
      fromJSON({ ...json, v: 2 as 1 });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    expect((thrown as Error).message).toContain("Unsupported schema version 2 (expected 1).");
  });

  it("the JSON path: a missing schema version is rejected (the strict validator stand)", () => {
    const { a } = seedParagraph();
    const json = a.toJSON();
    const rest: Record<string, unknown> = { ...json };
    delete rest.v;
    let thrown: unknown;
    try {
      fromJSON(rest as unknown as typeof json);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    expect((thrown as Error).message).toContain('Missing required field "v".');
  });

  it("an additive v1 attr survives loading (the lenient load keeps it)", () => {
    const { a, id } = seedParagraph();
    const attrs = new Y.Map();
    attrs.set("futureFlag", "preserve-me");
    const entry = a.raw.getMap("blocks").get(id) as Y.Map<unknown>;
    entry.set("attrs", attrs);
    const restored = loadDoc(a.encode());
    expect(restored.toJSON().blocks[id]).toMatchObject({ attrs: { futureFlag: "preserve-me" } });
    // The re-save keeps the attr (the opaque stand round-trips, no data loss).
    expect(loadDoc(restored.encode()).toJSON().blocks[id]).toMatchObject({ attrs: { futureFlag: "preserve-me" } });
  });
});
