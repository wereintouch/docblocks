import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";
import { writeDocument } from "../src/core/layout";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";
import { fixture } from "./fixtures";

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeDocJSON = (blocks: DocJSON["blocks"]): DocJSON => ({
  v: 1,
  id: "r",
  title: "",
  createdAt: CREATED_AT,
  blocks,
});

describe("createDoc", () => {
  it("creates a stable initial document: only the root block, root id === doc id", () => {
    const doc = createDoc({ id: "d1", title: "T", createdAt: CREATED_AT });
    expect(doc.toJSON()).toEqual({
      v: 1,
      id: "d1",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { d1: { type: "root", children: [] } },
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(doc.meta).toEqual({ v: 1, id: "d1", title: "T", createdAt: CREATED_AT });
  });

  it("uses the injected id generator when no id is given", () => {
    const doc = createDoc({ generateId: () => "generated" });
    const json = doc.toJSON();
    expect(json.id).toBe("generated");
    expect(Object.keys(json.blocks)).toEqual(["generated"]);
  });

  it("defaults to a random id, empty title, and a current ISO createdAt", () => {
    const json = createDoc().toJSON();
    expect(json.id).toBeTypeOf("string");
    expect(json.id.length).toBeGreaterThan(0);
    expect(json.title).toBe("");
    expect(Number.isNaN(new Date(json.createdAt).getTime())).toBe(false);
    expect(Object.keys(json.blocks)).toEqual([json.id]);
    expect(validateDoc(json)).toEqual([]);
  });
});

describe("fromJSON / toJSON round-trip", () => {
  it("round-trips the golden fixture and is stable on repeat", () => {
    const doc = fromJSON(fixture);
    expect(doc.toJSON()).toEqual(fixture);
    expect(fromJSON(doc.toJSON()).toJSON()).toEqual(fixture);
  });

  it("drops empty content on text types and keeps the table-cell exception", () => {
    const doc = fromJSON(
      makeDocJSON({
        r: { type: "root", children: ["p", "t"] },
        p: { type: "paragraph", content: [{ text: "", marks: {} }] },
        t: { type: "table", columnOrder: ["col1", "col2"], children: ["row"] },
        row: { type: "table-row", children: ["c1", "c2"] },
        c1: { type: "table-cell", attrs: { columnId: "col1" }, content: [] },
        c2: { type: "table-cell", attrs: { columnId: "col2" } },
      })
    );
    expect(doc.toJSON().blocks.p).toEqual({ type: "paragraph" });
    expect(doc.toJSON().blocks.c1).toEqual({ type: "table-cell", attrs: { columnId: "col1" }, content: [] });
    expect(doc.toJSON().blocks.c2).toEqual({ type: "table-cell", attrs: { columnId: "col2" }, content: [] });
  });

  it("throws a typed InvalidSnapshotError carrying the validation errors on invalid input", () => {
    const invalid = makeDocJSON({}); // missing root
    const errors = validateDoc(invalid, true);
    expect(errors.length).toBeGreaterThan(0);
    let thrown: unknown;
    try {
      fromJSON(invalid);
    } catch (e) {
      thrown = e;
    }
    // The typed error stand (instanceof / .message work); the message
    // carries every validation error.
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    const message = (thrown as Error).message;
    expect(message).toContain(errors[0]!.message);
  });

  it("throws for a root block keyed differently from the document id", () => {
    const invalid = makeDocJSON({ other: { type: "root", children: [] } });
    let thrown: unknown;
    try {
      fromJSON(invalid);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(InvalidSnapshotError);
    expect((thrown as Error).message).toContain('The root block must be keyed by the document id "r" (got "other").');
  });
});

describe("encoding", () => {
  it("encode → loadDoc on a fresh doc converges to the same JSON", () => {
    const source = fromJSON(fixture);
    const restored = loadDoc(source.encode());
    expect(restored.toJSON()).toEqual(source.toJSON());
  });

  it("encodeUpdate(stateVector) diffs against a less-informed peer and converges", () => {
    const full = fromJSON(fixture);
    // A peer holding state that does not overlap the document layout (plus a
    // custom Yjs map that coexists with docblocks state): its state vector is
    // a real (non-empty) vector, so the diff is the whole layout.
    const holder = new Y.Doc();
    holder.transact(() => {
      holder.getMap("scratch").set("k", 1);
    });
    const delta = full.encodeUpdate(Y.encodeStateVector(holder));
    Y.applyUpdate(holder, delta);
    // The merged holder now carries the full layout: its full snapshot loads
    // cleanly (only the docblocks state is validated; the scratch map is inert).
    const peer = loadDoc(Y.encodeStateAsUpdate(holder));
    expect(peer.toJSON()).toEqual(full.toJSON());
  });

  it("a diff against a partial holder (same client lineage) converges to the full state", () => {
    // Single-client lineage: the empty-page state, extended in place with the
    // fixture blocks; the holder of the earlier state receives only the diff.
    const yFull = new Y.Doc();
    writeDocument(yFull, { ...fixture, blocks: { [fixture.id]: { type: "root", children: [] } } });
    const state1 = Y.encodeStateAsUpdate(yFull);
    writeDocument(yFull, fixture);
    const holder = new Y.Doc();
    Y.applyUpdate(holder, state1);
    const delta = Y.encodeStateAsUpdate(yFull, Y.encodeStateVector(holder));
    Y.applyUpdate(holder, delta);
    expect(loadDoc(Y.encodeStateAsUpdate(holder)).toJSON()).toEqual(fixture);
  });

  it("encodeUpdate of a fully up-to-date holder is a safe no-op delta", () => {
    const full = fromJSON(fixture);
    const peer = loadDoc(full.encode());
    const delta = full.encodeUpdate(Y.encodeStateVector(peer.raw));
    const peer2 = loadDoc(full.encode());
    peer2.applyUpdate(delta);
    expect(peer2.toJSON()).toEqual(full.toJSON());
  });

  it("encodes are stable for the same document", () => {
    const doc = fromJSON(fixture);
    expect(doc.encode()).toEqual(doc.encode());
  });
});
