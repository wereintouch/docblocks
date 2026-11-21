import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { Doc, InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";
import { fixture } from "./fixtures";

/**
 * The Doc lifecycle's stands (the sibling of core.test.ts): the updatedAt
 * out of the JSON, the public surface, and the loadDoc's snapshot guard.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

describe("updatedAt stays out of the JSON form", () => {
  it("toJSON and doc.meta never contain updatedAt", () => {
    const doc = fromJSON(fixture);
    expect(JSON.stringify(doc.toJSON())).not.toContain("updatedAt");
    expect(Object.keys(doc.meta)).toEqual(["v", "id", "title", "createdAt"]);
    const fresh = createDoc({ id: "d2", title: "", createdAt: CREATED_AT });
    expect(JSON.stringify(fresh.toJSON())).not.toContain("updatedAt");
    expect(fresh.meta).not.toHaveProperty("updatedAt");
  });
});

describe("public surface", () => {
  it("exposes the Doc class and lifecycle functions", () => {
    expect(Doc).toBeTypeOf("function");
    expect(createDoc().toJSON().v).toBe(1);
    expect(loadDoc(fromJSON(fixture).encode()).meta.id).toBe(fixture.id);
  });
});

describe("loadDoc snapshot guard", () => {
  it("rejects an incremental delta (a partial state on an empty doc)", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT });
    const sv0 = Y.encodeStateVector(doc.raw);
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "abc");
    const delta = doc.encodeUpdate(sv0);

    expect(() => loadDoc(delta)).toThrow(InvalidSnapshotError);
  });

  it("rejects empty and garbage bytes", () => {
    expect(() => loadDoc(new Uint8Array(0))).toThrow(InvalidSnapshotError);
    expect(() => loadDoc(new Uint8Array([1, 2, 3]))).toThrow(InvalidSnapshotError);
  });

  it("base snapshot + applyUpdate(diff) is the supported composition", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT });
    const base = doc.encode();
    const sv = Y.encodeStateVector(doc.raw);
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "hello");
    const delta = doc.encodeUpdate(sv);

    const reloaded = loadDoc(base);
    reloaded.applyUpdate(delta);
    expect(reloaded.getText(id)).toBe("hello");
  });
});
