import { describe, expect, it } from "vitest";

import {
  DocBlocksError,
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  createDoc,
} from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "d", createdAt: CREATED_AT });

const paragraphWith = (text: string): { doc: Doc; id: string } => {
  const doc = newDoc();
  const id = doc.insertBlock("paragraph");
  if (text !== "") doc.insertText(id, 0, text);
  return { doc, id };
};

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

describe("insertText", () => {
  it("inserts into an empty block as a single plain run", () => {
    const { doc, id } = paragraphWith("");
    doc.insertText(id, 0, "hello");
    expect(doc.getRuns(id)).toEqual([{ text: "hello", marks: {} }]);
    expect(doc.getTextLength(id)).toBe(5);
    expect(doc.toJSON().blocks[id]).toEqual({ type: "paragraph", content: [{ text: "hello", marks: {} }] });
  });

  it("mid-run insert with equal marks stays one run", () => {
    const { doc, id } = paragraphWith("abcdef");
    doc.insertText(id, 3, "XY");
    expect(doc.getRuns(id)).toEqual([{ text: "abcXYdef", marks: {} }]);
  });

  it("mid-run insert with different marks splits into three runs", () => {
    const { doc, id } = paragraphWith("abcdef");
    doc.insertText(id, 3, "XY", { bold: true });
    expect(doc.getRuns(id)).toEqual([
      { text: "abc", marks: {} },
      { text: "XY", marks: { bold: true } },
      { text: "def", marks: {} },
    ]);
    expect(doc.getTextLength(id)).toBe(8);
  });

  it("boundary insert joins the next run with equal marks (no new run)", () => {
    const { doc, id } = paragraphWith("");
    doc.insertText(id, 0, "abc");
    doc.insertText(id, 3, "def", { bold: true });
    doc.insertText(id, 3, "XY", { bold: true });
    expect(doc.getRuns(id)).toEqual([
      { text: "abc", marks: {} },
      { text: "XYdef", marks: { bold: true } },
    ]);
  });

  it("boundary insert joins the previous run with equal marks", () => {
    const { doc, id } = paragraphWith("");
    doc.insertText(id, 0, "abc");
    doc.insertText(id, 3, "def", { bold: true });
    doc.insertText(id, 3, "XY");
    expect(doc.getRuns(id)).toEqual([
      { text: "abcXY", marks: {} },
      { text: "def", marks: { bold: true } },
    ]);
  });

  it("boundary insert with no matching marks creates a new run", () => {
    const { doc, id } = paragraphWith("");
    doc.insertText(id, 0, "abc");
    doc.insertText(id, 3, "def", { bold: true });
    doc.insertText(id, 3, "XY", { italic: true });
    expect(doc.getRuns(id)).toEqual([
      { text: "abc", marks: {} },
      { text: "XY", marks: { italic: true } },
      { text: "def", marks: { bold: true } },
    ]);
  });

  it("carries attribute marks into a fresh run", () => {
    const { doc, id } = paragraphWith("");
    doc.insertText(id, 0, "hi", { bold: true, link: { href: "/x" } });
    expect(doc.getRuns(id)).toEqual([{ text: "hi", marks: { bold: true, link: { href: "/x" } } }]);
  });

  it("empty text is a no-op", () => {
    const { doc, id } = paragraphWith("abc");
    doc.insertText(id, 1, "");
    expect(doc.getRuns(id)).toEqual([{ text: "abc", marks: {} }]);
  });

  it("rejects a non-integer position without mutating the block", () => {
    const { doc, id } = paragraphWith("abcdef");
    const before = doc.encode().byteLength;
    expect(() => doc.insertText(id, 1.5, "x")).toThrow(InvalidRangeError);
    expect(doc.getText(id)).toBe("abcdef");
    expect(doc.encode().byteLength).toBe(before);
  });

  it("appends at the end of the text (pos === total)", () => {
    const { doc, id } = paragraphWith("abc");
    doc.insertText(id, 3, "def");
    expect(doc.getRuns(id)).toEqual([{ text: "abcdef", marks: {} }]);

    const { doc: doc2, id: id2 } = paragraphWith("abc");
    doc2.insertText(id2, 3, "XY", { bold: true });
    expect(doc2.getRuns(id2)).toEqual([
      { text: "abc", marks: {} },
      { text: "XY", marks: { bold: true } },
    ]);
  });

  it("invalid position, target, and content type -> typed errors", () => {
    const { doc, id } = paragraphWith("abc");
    expect(() => doc.insertText(id, 4, "x")).toThrow(InvalidRangeError);
    expect(() => doc.insertText(id, -1, "x")).toThrow(InvalidRangeError);
    expect(() => doc.insertText("nope", 0, "x")).toThrow(UnknownBlockError);
    const divider = doc.insertBlock("divider");
    expect(() => doc.insertText(divider, 0, "x")).toThrow(InvalidOperationError);
  });

  it("marks are rejected in a code block, plain text is accepted", () => {
    const doc = newDoc();
    const code = doc.insertBlock("code");
    const error = expectThrows(() => doc.insertText(code, 0, "x", { bold: true }), InvalidMarkError);
    expect(error.message).toContain(code);
    doc.insertText(code, 0, "x");
    expect(doc.getRuns(code)).toEqual([{ text: "x", marks: {} }]);
  });
});

describe("deleteText", () => {
  it("trims a run partially", () => {
    const { doc, id } = paragraphWith("abcdef");
    doc.deleteText(id, 2, 4);
    expect(doc.getRuns(id)).toEqual([{ text: "abef", marks: {} }]);
    expect(doc.getTextLength(id)).toBe(4);
  });

  it("drops fully covered middle runs and trims the last touched run", () => {
    const doc = newDoc();
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "abc");
    doc.insertText(id, 3, "XY", { bold: true });
    doc.insertText(id, 5, "def", { italic: true });
    doc.deleteText(id, 3, 7); // "XY" fully covered, "de" of the italic run
    expect(doc.getRuns(id)).toEqual([
      { text: "abc", marks: {} },
      { text: "f", marks: { italic: true } },
    ]);
  });

  it("adjacent plain runs merge lazily after a middle drop", () => {
    const doc = newDoc();
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "abc");
    doc.insertText(id, 3, "XY", { bold: true });
    doc.insertText(id, 5, "def");
    doc.deleteText(id, 3, 5);
    expect(doc.getRuns(id)).toEqual([{ text: "abcdef", marks: {} }]);
  });

  it("deleting all text leaves content absent (paragraph) or empty (table-cell)", () => {
    const { doc, id } = paragraphWith("abc");
    doc.deleteText(id, 0, 3);
    expect(doc.toJSON().blocks[id]).toEqual({ type: "paragraph" });

    const doc2 = newDoc();
    const table = doc2.insertBlock("table", { cols: 1 });
    const row = doc2.insertBlock("table-row", undefined, { parent: table });
    const cell = doc2.insertBlock("table-cell", undefined, { parent: row });
    doc2.insertText(cell, 0, "x");
    doc2.deleteText(cell, 0, 1);
    expect(doc2.toJSON().blocks[cell]).toMatchObject({ type: "table-cell", content: [] });
  });

  it("from === to is a no-op; invalid ranges throw typed errors", () => {
    const { doc, id } = paragraphWith("abc");
    doc.deleteText(id, 1, 1);
    expect(doc.getText(id)).toBe("abc");
    expect(() => doc.deleteText(id, 2, 1)).toThrow(InvalidRangeError);
    expect(() => doc.deleteText(id, 0, 4)).toThrow(InvalidRangeError);
    expect(() => doc.deleteText(id, -1, 1)).toThrow(InvalidRangeError);
    expect(() => doc.deleteText("nope", 0, 1)).toThrow(UnknownBlockError);
    const divider = doc.insertBlock("divider");
    expect(() => doc.deleteText(divider, 0, 1)).toThrow(InvalidOperationError);
  });

  it("rejects a non-integer range without mutating the block", () => {
    const { doc, id } = paragraphWith("abcdef");
    const before = doc.encode().byteLength;
    expect(() => doc.deleteText(id, 0, 1.5)).toThrow(InvalidRangeError);
    expect(() => doc.deleteText(id, 0.5, 3)).toThrow(InvalidRangeError);
    expect(doc.getText(id)).toBe("abcdef");
    expect(doc.encode().byteLength).toBe(before);
  });

  it("throws for an out-of-bounds from === to instead of no-op-ing", () => {
    const { doc, id } = paragraphWith("abc");
    expect(() => doc.deleteText(id, 99, 99)).toThrow(InvalidRangeError);
    expect(doc.getText(id)).toBe("abc");
  });
});
