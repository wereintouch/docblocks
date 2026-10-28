import { describe, expect, it } from "vitest";

import {
  DocBlocksError,
  InvalidAttrsError,
  InvalidChildError,
  InvalidOperationError,
  UnknownBlockError,
  UnknownBlockTypeError,
  createDoc,
} from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

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

describe("changeBlockType", () => {
  it("turns a paragraph into a list item (content survives, the required attr is set)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "hello");

    doc.changeBlockType(p, "list-item", { list: "number" });

    const block = doc.getBlock(p);
    expect(block?.type).toBe("list-item");
    if (block?.type !== "list-item") throw new Error("the type did not change");
    expect(block.attrs.list).toBe("number");
    expect(doc.getText(p)).toBe("hello");
    // Structurally childless: the nesting is the indent attr, not a children field.
    expect(doc.getChildren(p)).toEqual([]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("turns a list item back into a paragraph (list-specific attrs are dropped)", () => {
    const doc = newDoc();
    const li = doc.insertBlock("list-item", { list: "task", checked: true, align: "center" });
    doc.insertText(li, 0, "todo");

    doc.changeBlockType(li, "paragraph");

    const block = doc.getBlock(li);
    expect(block?.type).toBe("paragraph");
    if (block?.type !== "paragraph") throw new Error("the type did not change");
    expect(block.attrs).toEqual({ align: "center" });
    expect(doc.getText(li)).toBe("todo");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("carries over the attrs the target also declares and drops the rest", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2, align: "right" });
    doc.insertText(h, 0, "title");

    doc.changeBlockType(h, "list-item", { list: "bullet" });

    const block = doc.getBlock(h);
    expect(block?.type).toBe("list-item");
    if (block?.type !== "list-item") throw new Error("the type did not change");
    // `level` is heading-specific (dropped); `align` is shared (carried).
    expect(block.attrs).toEqual({ list: "bullet", align: "right" });
  });

  it("validates the target's required attrs", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    // The typed args already reject a missing required attr; the runtime
    // guard is pinned through a cast.
    expectThrows(() => doc.changeBlockType(p, "heading", undefined as never), InvalidAttrsError);
    doc.changeBlockType(p, "heading", { level: 4 });
    const block = doc.getBlock(p);
    expect(block?.type).toBe("heading");
    if (block?.type !== "heading") throw new Error("the type did not change");
    expect(block.attrs.level).toBe(4);
  });

  it("the patch overrides the carried attrs", () => {
    const doc = newDoc();
    const li = doc.insertBlock("list-item", { list: "bullet", align: "center" });

    doc.changeBlockType(li, "paragraph", { align: "right" });

    const block = doc.getBlock(li);
    expect(block?.type).toBe("paragraph");
    if (block?.type !== "paragraph") throw new Error("the type did not change");
    expect(block.attrs).toEqual({ align: "right" });
  });

  it("rejects a same-type transition", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    expectThrows(() => doc.changeBlockType(p, "paragraph"), InvalidOperationError);
  });

  it("rejects dropping the content (a contentful type into a contentless one)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "kept");
    expectThrows(() => doc.changeBlockType(p, "table", undefined), InvalidOperationError);
    expect(doc.getText(p)).toBe("kept");
  });

  it("rejects a contentful block becoming a contentless one (the text would be lost)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "keep");
    const nested = doc.insertBlock("paragraph");
    doc.updateBlock(nested, { indent: 1 }); // the flat "child" of p

    expectThrows(() => doc.changeBlockType(p, "image", { src: "blobs/x.png" }), InvalidOperationError);

    const block = doc.getBlock(p);
    expect(block?.type).toBe("paragraph");
    expect(doc.getChildren(p)).toEqual([]);
  });

  it("rejects children the target cannot hold", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });

    expectThrows(() => doc.changeBlockType(table, "list-item", { list: "bullet" }), InvalidOperationError);
    expect(row).toBeDefined();
  });

  it("rejects an unknown block, an unknown type, and the root", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    expectThrows(() => doc.changeBlockType("nope", "list-item", { list: "bullet" }), UnknownBlockError);
    expectThrows(() => doc.changeBlockType(p, "bookmark" as never, undefined as never), UnknownBlockTypeError);
    expectThrows(() => doc.changeBlockType(doc.meta.id, "paragraph"), InvalidOperationError);
  });

  it("creates the content array for a contentless -> contentful step", () => {
    const doc = newDoc();
    // A table has no content; a paragraph does. The table's childless form
    // transitions into a paragraph with an empty (fresh) content.
    const table = doc.insertBlock("table", { cols: 1 });
    doc.changeBlockType(table, "paragraph");
    const block = doc.getBlock(table);
    expect(block?.type).toBe("paragraph");
    expect(doc.getTextLength(table)).toBe(0);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects a new type the block's parent cannot hold", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    // table-cell is not a root-level type (the registry forbids it).
    expectThrows(() => doc.changeBlockType(p, "table-cell"), InvalidChildError);

    // A cell inside a row may not become a paragraph (the row holds cells only).
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    expectThrows(() => doc.changeBlockType(cell, "paragraph"), InvalidChildError);
    expect(doc.getBlock(cell)?.type).toBe("table-cell");
  });

  it("accepts a target whose attrs are all optional (the dropped cols attr is gone)", () => {
    const doc = newDoc();
    // A rowless table (contentless, attrs of its own) becomes a paragraph
    // (only optional attrs): the dropped cols attr is gone, nothing is written.
    const table = doc.insertBlock("table", { cols: 1 });
    doc.changeBlockType(table, "paragraph");
    const block = doc.getBlock(table);
    expect(block?.type).toBe("paragraph");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects a patch with an attr the target does not declare", () => {
    const doc = newDoc();
    // A divider declares only the indent attr: a patch with a foreign key
    // fails the post-patch validation.
    const table = doc.insertBlock("table", { cols: 1 });
    expectThrows(() => doc.changeBlockType(table, "divider", { extra: 1 } as never), InvalidAttrsError);
  });

  it("creates fresh rows for a rows-less -> rows step and drops them the other way", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    doc.changeBlockType(table, "database", { columns: [{ id: "name", name: "Name", type: "text" }] });
    expect(doc.getBlock(table)?.type).toBe("database");
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // Back to a rows-less type: the empty rows data is dropped, the doc
    // stays valid (no stale row data resurfaces).
    doc.changeBlockType(table, "image", { src: "blobs/x.png" });
    expect(doc.getBlock(table)?.type).toBe("image");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("rejects a rows-carrying block becoming a rows-less one while it holds rows", () => {
    const doc = newDoc();
    const db = doc.insertBlock("database", { columns: [{ id: "name", name: "Name", type: "text" }] });
    const row = doc.insertRow(db);
    doc.setCell(db, row, "name", "a");
    expectThrows(() => doc.changeBlockType(db, "image", { src: "blobs/x.png" }), InvalidOperationError);
    expect(doc.getBlock(db)?.type).toBe("database");
  });

  it("enforces the block-level invariants of the target type", () => {
    const doc = newDoc();
    // A database select column without options (insertBlock parity).
    const divider = doc.insertBlock("divider");
    expectThrows(
      () =>
        doc.changeBlockType(divider, "database", {
          columns: [{ id: "c1", name: "C", type: "select" }],
        }),
      InvalidAttrsError
    );

    // A connector with empty refs (the canvas invariants).
    const surface = doc.insertBlock("surface");
    const shape = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
    expectThrows(() => doc.changeBlockType(shape, "connector", { start: {}, end: {} }), InvalidAttrsError);
  });

  it("undo restores the previous type with its attrs (one whole-map step)", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    doc.insertText(h, 0, "title");

    doc.changeBlockType(h, "list-item", { list: "bullet" });
    expect(doc.getBlock(h)?.type).toBe("list-item");

    doc.undo();
    const restored = doc.getBlock(h);
    expect(restored?.type).toBe("heading");
    if (restored?.type !== "heading") throw new Error("the type was not restored");
    expect(restored.attrs.level).toBe(2);
    expect(doc.getText(h)).toBe("title");
  });
});

describe("changeBlockType: quote", () => {
  it("turns a paragraph into a quote (content survives, the shared align is carried)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph", { align: "center" });
    doc.insertText(p, 0, "borrowed words");

    doc.changeBlockType(p, "quote");

    const block = doc.getBlock(p);
    expect(block?.type).toBe("quote");
    if (block?.type !== "quote") throw new Error("the type did not change");
    expect(block.attrs).toEqual({ align: "center" });
    expect(doc.getText(p)).toBe("borrowed words");
  });

  it("turns a quote back into a paragraph (the content stands)", () => {
    const doc = newDoc();
    const q = doc.insertBlock("quote");
    doc.insertText(q, 0, "first line\nsecond line");

    doc.changeBlockType(q, "paragraph");

    expect(doc.getBlock(q)?.type).toBe("paragraph");
    expect(doc.getText(q)).toBe("first line\nsecond line");
  });

  it("rejects the quote inside a table cell (the cell holds the v1 leaf set only)", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    const p = doc.insertBlock("paragraph", undefined, { parent: cell });
    expectThrows(() => doc.changeBlockType(p, "quote"), InvalidChildError);
  });
});
