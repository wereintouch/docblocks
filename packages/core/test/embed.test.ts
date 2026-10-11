import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DocBlocksError, InvalidAttrsError, InvalidChildError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import type { EmbedAttrs } from "../src/schema";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

const KINDS = ["iframe", "github", "figma", "loom", "html"] as const;

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

/** A minimal valid doc carrying one top-level embed block under `e1`. */
const docWithEmbed = (attrs: unknown): unknown => ({
  v: 1,
  id: "d1",
  title: "",
  createdAt: CREATED_AT,
  blocks: {
    d1: { type: "root", children: ["e1"] },
    e1: { type: "embed", attrs },
  },
});

describe("insertBlock", () => {
  it("inserts every registry kind with the required attrs", () => {
    const doc = newDoc();
    const ids = KINDS.map((kind) => doc.insertBlock("embed", { kind, src: `https://example.com/${kind}` }));
    KINDS.forEach((kind, index) => {
      expect(doc.getBlock(ids[index]!)).toEqual({
        type: "embed",
        attrs: { kind, src: `https://example.com/${kind}` },
      });
    });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("keeps the optional title when given", () => {
    const doc = newDoc();
    const id = doc.insertBlock("embed", { kind: "github", src: "https://github.com/x/y", title: "Repo" });
    expect(doc.getBlock(id)).toEqual({
      type: "embed",
      attrs: { kind: "github", src: "https://github.com/x/y", title: "Repo" },
    });
  });

  it("an out-of-enum kind is a type error and throws at runtime", () => {
    const doc = newDoc();
    expect(() => {
      // @ts-expect-error — "nope" is not an embed kind
      doc.insertBlock("embed", { kind: "nope", src: "https://example.com" });
    }).toThrow(InvalidAttrsError);
  });

  it("attrs failing the registry rules -> InvalidAttrsError", () => {
    const doc = newDoc();
    const error = expectThrows(
      () => doc.insertBlock("embed", { kind: "nope" as unknown as EmbedAttrs["kind"], src: "https://example.com" }),
      InvalidAttrsError
    );
    expect(error.message).toContain("kind");
    expect(() => doc.insertBlock("embed", { kind: "iframe" } as unknown as EmbedAttrs)).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "" })).toThrow(InvalidAttrsError);
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: 42 } as unknown as EmbedAttrs)).toThrow(
      InvalidAttrsError
    );
    expect(() => doc.insertBlock("embed", { kind: "iframe", src: "https://example.com", bogus: 1 } as never)).toThrow(
      InvalidAttrsError
    );
  });
});

describe("round-trip", () => {
  it("toJSON -> fromJSON -> toJSON is identical", () => {
    const doc = newDoc();
    const id = doc.insertBlock("embed", { kind: "figma", src: "https://figma.com/file", title: "Figma" });
    const before = doc.toJSON();
    const restored = fromJSON(before);
    expect(restored.toJSON()).toEqual(before);
    expect(restored.getBlock(id)).toEqual({
      type: "embed",
      attrs: { kind: "figma", src: "https://figma.com/file", title: "Figma" },
    });
  });
});

describe("updateBlock", () => {
  it("patches attrs and keeps the rest", () => {
    const doc = newDoc();
    const id = doc.insertBlock("embed", { kind: "iframe", src: "https://example.com" });
    doc.updateBlock(id, { kind: "html", title: "Page" });
    expect(doc.getBlock(id)).toEqual({
      type: "embed",
      attrs: { kind: "html", src: "https://example.com", title: "Page" },
    });
    expect(() => doc.updateBlock(id, { kind: "nope" as unknown as EmbedAttrs["kind"] })).toThrow(InvalidAttrsError);
    expect(doc.getBlock(id)).toEqual({
      type: "embed",
      attrs: { kind: "html", src: "https://example.com", title: "Page" },
    });
  });
});

describe("moveBlock / removeBlock", () => {
  it("moves and removes like any other block", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const e = doc.insertBlock("embed", { kind: "loom", src: "https://loom.com/x" });
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
    const embed = doc.insertBlock("embed", { kind: "figma", src: "https://figma.com/file" }, { parent: cell });
    expect(doc.getChildren(cell)).toEqual([embed]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
    // A leaf: it carries no children of its own.
    expect(() => doc.insertBlock("paragraph", undefined, { parent: embed })).toThrow(InvalidChildError);
  });
});

describe("strict validation (validateDoc)", () => {
  it("flags a malformed embed attrs object", () => {
    const missing = validateDoc(docWithEmbed({ kind: "iframe" }));
    expect(missing.some((e) => e.path === "blocks.e1.attrs.src")).toBe(true);

    const badKind = validateDoc(docWithEmbed({ kind: "youtube", src: "https://example.com" }));
    expect(badKind.some((e) => e.path === "blocks.e1.attrs.kind")).toBe(true);

    const nonString = validateDoc(docWithEmbed({ kind: "iframe", src: 42 }));
    expect(nonString.some((e) => e.path === "blocks.e1.attrs.src")).toBe(true);

    const empty = validateDoc(docWithEmbed({ kind: "iframe", src: "" }));
    expect(empty.some((e) => e.path === "blocks.e1.attrs.src")).toBe(true);
  });

  it("accepts a well-formed embed", () => {
    expect(validateDoc(docWithEmbed({ kind: "loom", src: "https://loom.com/x", title: "Clip" }))).toEqual([]);
  });
});

describe("lenient reader (newer-minor data)", () => {
  it("reads an unknown kind as-is; the validator flags it", () => {
    const source = newDoc();
    const id = source.insertBlock("embed", { kind: "iframe", src: "https://example.com/embed" });
    // A kind value this core's enum does not know, written at the CRDT level:
    // the way newer-minor data arrives (over the wire, not via the commands).
    source.raw.transact(() => {
      const block = source.raw.getMap("blocks").get(id) as Y.Map<unknown>;
      (block.get("attrs") as Y.Map<unknown>).set("kind", "youtube");
    });

    const target = newDoc();
    target.applyUpdate(source.encode()); // the CRDT level applies remote data without validation

    expect(target.getBlock(id)).toEqual({
      type: "embed",
      attrs: { kind: "youtube", src: "https://example.com/embed" },
    });
    expect(target.toJSON().blocks[id]).toEqual({
      type: "embed",
      attrs: { kind: "youtube", src: "https://example.com/embed" },
    });
    const error = validateDoc(target.toJSON()).find((entry) => entry.path === `blocks.${id}.attrs.kind`);
    expect(error?.message).toContain("youtube");
  });
});
