import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { Doc, InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";
import { writeDocument } from "../src/core/layout";
import { normalizeRuns } from "../src/core/normalize";
import { validateDoc } from "../src/schema";
import type { DocJSON, MarkSet, TextRun } from "../src/schema";
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

  it("throws the validateDoc errors as-is on invalid input", () => {
    const invalid = makeDocJSON({}); // missing root
    const errors = validateDoc(invalid);
    expect(errors.length).toBeGreaterThan(0);
    let thrown: unknown;
    try {
      fromJSON(invalid);
    } catch (e) {
      thrown = e;
    }
    // Thrown as-is: the raw validator list, unwrapped and untranslated.
    expect(Array.isArray(thrown)).toBe(true);
    expect(thrown).toEqual(errors);
  });

  it("throws for a root block keyed differently from the document id", () => {
    const invalid = makeDocJSON({ other: { type: "root", children: [] } });
    let thrown: unknown;
    try {
      fromJSON(invalid);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toEqual([
      { path: "blocks.other", message: 'The root block must be keyed by the document id "r" (got "other").' },
    ]);
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

describe("reads return plain snapshots", () => {
  const doc = fromJSON(fixture);

  it("getBlock is a plain object: JSON round-trip, no Yjs instances", () => {
    const block = doc.getBlock("b02");
    expect(block).not.toBeNull();
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(block).not.toBeInstanceOf(Y.Map);
    expect(block).not.toBeInstanceOf(Y.Array);
    expect(doc.getBlock("missing")).toBeNull();
  });

  it("getRuns is a plain array of plain runs (no Y.Map instances)", () => {
    const runs = doc.getRuns("b02");
    expect(Array.isArray(runs)).toBe(true);
    expect(JSON.parse(JSON.stringify(runs))).toEqual(runs);
    for (const run of runs) expect(run).not.toBeInstanceOf(Y.Map);
    expect(runs).toEqual([
      { text: "Sync goes over ", marks: {} },
      { text: "Yjs", marks: { bold: true } },
      { text: " via WebSocket.", marks: {} },
    ]);
  });

  it("getText / getChildren are plain values", () => {
    expect(typeof doc.getText("b02")).toBe("string");
    expect(doc.getChildren("d_8f3a2c")).toEqual(["b01", "b02", "b03", "b03a", "b04", "b06", "b07", "b08"]); // root id === doc id
    expect(doc.getChildren("b03")).toEqual([]); // flat page: the nesting is the indent attr, not children
    expect(doc.getChildren("b01")).toEqual([]); // paragraph: no children
    expect(doc.getChildren("missing")).toEqual([]);
  });

  it("getText flattens runs; empty for non-text types and missing blocks", () => {
    expect(doc.getText("b02")).toBe("Sync goes over Yjs via WebSocket.");
    expect(doc.getTextLength("b02")).toBe(doc.getText("b02").length);
    expect(doc.getText("b06")).toBe(""); // table: non-text
    expect(doc.getRuns("b06")).toEqual([]);
    expect(doc.getTextLength("b06")).toBe(0);
    expect(doc.getText("missing")).toBe("");
    expect(doc.getRuns("missing")).toEqual([]);
    expect(doc.getTextLength("missing")).toBe(0);
  });
});

describe("run normalization (lazy, at read/export)", () => {
  it("merges adjacent equal-marks runs and drops empty runs", () => {
    const doc = fromJSON(
      makeDocJSON({
        r: { type: "root", children: ["p"] },
        p: {
          type: "paragraph",
          content: [
            { text: "a", marks: { bold: true } },
            { text: "", marks: {} },
            { text: "b", marks: { bold: true } },
            { text: "c", marks: {} },
            { text: "", marks: { bold: true } },
          ],
        },
      })
    );
    expect(doc.getRuns("p")).toEqual([
      { text: "ab", marks: { bold: true } },
      { text: "c", marks: {} },
    ]);
    expect(doc.getText("p")).toBe("abc");
    expect(doc.toJSON().blocks.p).toEqual({
      type: "paragraph",
      content: [
        { text: "ab", marks: { bold: true } },
        { text: "c", marks: {} },
      ],
    });
  });

  it("keeps a mark-application split (distinct mark sets stay separate runs)", () => {
    // A range marked bold + color + highlight splits one run into three.
    const marked: TextRun[] = [
      { text: "Help us ", marks: {} },
      { text: "sync", marks: { bold: true, color: { value: "#0066CC" }, highlight: { value: "#FFF3B0" } } },
      { text: " faster!", marks: {} },
    ];
    const doc = fromJSON(
      makeDocJSON({ r: { type: "root", children: ["p"] }, p: { type: "paragraph", content: marked } })
    );
    expect(doc.getRuns("p")).toEqual(marked);
    expect(doc.getText("p")).toBe("Help us sync faster!");
    expect(doc.toJSON().blocks.p).toEqual({ type: "paragraph", content: marked });
  });
});

describe("normalizeRuns", () => {
  const run = (text: string, marks: MarkSet = {}): TextRun => ({ text, marks });

  it("drops empty runs and merges adjacent equal-marks runs", () => {
    expect(
      normalizeRuns([
        run("a", { bold: true }),
        run("", {}),
        run("b", { bold: true }),
        run("c"),
        run("d"),
        run("", { bold: true }),
      ])
    ).toEqual([run("ab", { bold: true }), run("cd")]);
  });

  it("does not merge across different mark sets (incl. attribute values)", () => {
    expect(
      normalizeRuns([
        run("a", { color: { value: "#111111" } }),
        run("b", { color: { value: "#222222" } }),
        run("c", { link: { href: "/a" } }),
        run("d", { link: { href: "/a" } }),
      ])
    ).toEqual([
      run("a", { color: { value: "#111111" } }),
      run("b", { color: { value: "#222222" } }),
      run("cd", { link: { href: "/a" } }),
    ]);
  });

  it("returns copied runs (no shared mark references with the input)", () => {
    const bold = { bold: true } as MarkSet;
    const result = normalizeRuns([run("a", bold), run("b", bold)]);
    expect(result).toEqual([run("ab", { bold: true })]);
    expect(result[0]?.marks).not.toBe(bold);
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeRuns([])).toEqual([]);
  });
});

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
