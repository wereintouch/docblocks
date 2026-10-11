import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidAttrsError, InvalidChildError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { SyncEmbedAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

/** A minimal valid doc carrying one top-level sync-embed block under `e1`. */
const docWithSyncEmbed = (attrs: unknown): unknown => ({
  v: 1,
  id: "d1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    d1: { type: "root", children: ["e1"] },
    e1: { type: "sync-embed", attrs },
  },
});

describe("insertBlock", () => {
  it("inserts a full-doc ref and a subtree ref", () => {
    const doc = newDoc();
    const full = doc.insertBlock("sync-embed", { ref: { docId: "master-1" } });
    const subtree = doc.insertBlock("sync-embed", { ref: { docId: "master-1", blockId: "b7" } });
    expect(doc.getBlock(full)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-1" } } });
    expect(doc.getBlock(subtree)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-1", blockId: "b7" } } });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a malformed ref literal is a type error", () => {
    const doc = newDoc();
    expect(() => {
      // @ts-expect-error — the ref is an object, not a string
      doc.insertBlock("sync-embed", { ref: "master-1" });
    }).toThrow(InvalidAttrsError);
  });
});

describe("round-trip", () => {
  it("toJSON -> fromJSON -> toJSON is identical (both ref shapes)", () => {
    const doc = newDoc();
    const full = doc.insertBlock("sync-embed", { ref: { docId: "master-1" } });
    const subtree = doc.insertBlock("sync-embed", { ref: { docId: "master-1", blockId: "b7" } });
    const before = doc.toJSON();
    const restored = fromJSON(before);
    expect(restored.toJSON()).toEqual(before);
    expect(restored.getBlock(full)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-1" } } });
    expect(restored.getBlock(subtree)).toEqual({
      type: "sync-embed",
      attrs: { ref: { docId: "master-1", blockId: "b7" } },
    });
  });
});

describe("updateBlock", () => {
  it("replaces the ref and keeps the rest", () => {
    const doc = newDoc();
    const id = doc.insertBlock("sync-embed", { ref: { docId: "master-1" } });
    doc.updateBlock(id, { ref: { docId: "master-2", blockId: "b9" } });
    expect(doc.getBlock(id)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-2", blockId: "b9" } } });
    expect(() => doc.updateBlock(id, { ref: { docId: "" } as unknown as SyncEmbedAttrs["ref"] })).toThrow(
      InvalidAttrsError
    );
    // The failed patch left the block untouched.
    expect(doc.getBlock(id)).toEqual({ type: "sync-embed", attrs: { ref: { docId: "master-2", blockId: "b9" } } });
  });
});

describe("moveBlock / removeBlock", () => {
  it("moves and removes like any other block", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const e = doc.insertBlock("sync-embed", { ref: { docId: "master-1" } });
    const b = doc.insertBlock("paragraph");
    doc.moveBlock(e, "r", 0);
    expect(doc.getChildren("r")).toEqual([e, a, b]);
    doc.removeBlock(e);
    expect(doc.getChildren("r")).toEqual([a, b]);
    expect(doc.getBlock(e)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});

describe("table cells", () => {
  it("inserts inside a table cell (a leaf type) and the doc stays valid", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    const embed = doc.insertBlock("sync-embed", { ref: { docId: "master-1" } }, { parent: cell });
    expect(doc.getChildren(cell)).toEqual([embed]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    // A leaf: it carries no children of its own, and the type restriction
    // applies to moves as well as inserts.
    expect(() => doc.insertBlock("paragraph", undefined, { parent: embed })).toThrow(InvalidChildError);
    expect(() => doc.moveBlock(embed, table, 0)).toThrow(InvalidChildError);
  });
});

describe("strict validation (validateDoc)", () => {
  it("flags every malformed ref shape", () => {
    const asString = validateDoc(docWithSyncEmbed({ ref: "master-1" }));
    expect(asString.some((e) => e.path === "blocks.e1.attrs.ref" && e.message.includes("plain object"))).toBe(true);

    const missing = validateDoc(docWithSyncEmbed({}));
    expect(missing.some((e) => e.path === "blocks.e1.attrs.ref")).toBe(true);

    const missingDocId = validateDoc(docWithSyncEmbed({ ref: {} }));
    expect(missingDocId.some((e) => e.path === "blocks.e1.attrs.ref.docId")).toBe(true);

    const emptyDocId = validateDoc(docWithSyncEmbed({ ref: { docId: "" } }));
    expect(emptyDocId.some((e) => e.path === "blocks.e1.attrs.ref.docId")).toBe(true);

    const nonStringDocId = validateDoc(docWithSyncEmbed({ ref: { docId: 42 } }));
    expect(nonStringDocId.some((e) => e.path === "blocks.e1.attrs.ref.docId")).toBe(true);

    const emptyBlockId = validateDoc(docWithSyncEmbed({ ref: { docId: "m", blockId: "" } }));
    expect(emptyBlockId.some((e) => e.path === "blocks.e1.attrs.ref.blockId")).toBe(true);

    const nonStringBlockId = validateDoc(docWithSyncEmbed({ ref: { docId: "m", blockId: 42 } }));
    expect(nonStringBlockId.some((e) => e.path === "blocks.e1.attrs.ref.blockId")).toBe(true);

    const emptyObject = validateDoc(docWithSyncEmbed({ ref: { docId: "m", blockId: "b", bogus: null } }));
    expect(emptyObject.some((e) => e.path === "blocks.e1.attrs.ref.bogus")).toBe(true);
  });

  it("accepts a well-formed sync-embed", () => {
    expect(validateDoc(docWithSyncEmbed({ ref: { docId: "master-1" } }))).toEqual([]);
    expect(validateDoc(docWithSyncEmbed({ ref: { docId: "master-1", blockId: "b7" } }))).toEqual([]);
  });
});

describe("lenient reader (newer-minor data)", () => {
  it("reads an extra ref field as-is; the validator flags it", () => {
    const source = newDoc();
    const id = source.insertBlock("sync-embed", { ref: { docId: "master-1" } });
    // A field this core's registry does not know, written at the CRDT level
    // into the nested ref map: the way newer-minor data arrives (over the
    // wire, not via the commands).
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(id) as Y.Map<unknown>;
      const attrs = block.get("attrs") as Y.Map<unknown>;
      (attrs.get("ref") as Y.Map<unknown>).set("anchor", "top");
    });

    const target = newDoc();
    target.applyUpdate(source.encode()); // the CRDT level applies remote data without validation

    expect(target.getBlock(id)).toEqual({
      type: "sync-embed",
      attrs: { ref: { docId: "master-1", anchor: "top" } },
    });
    expect(target.toJSON().blocks[id]).toEqual({
      type: "sync-embed",
      attrs: { ref: { docId: "master-1", anchor: "top" } },
    });
    const error = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${id}.attrs.ref.anchor`);
    expect(error?.message).toContain("anchor");
  });
});
