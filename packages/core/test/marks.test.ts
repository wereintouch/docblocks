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
import type { MarkName } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "d", createdAt: CREATED_AT });

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

/** The schema §4.2 document: one plain run "Help us sync faster!" (20 chars). */
const markedDoc = (): { doc: Doc; id: string } => {
  const doc = newDoc();
  const id = doc.insertBlock("paragraph");
  doc.insertText(id, 0, "Help us sync faster!");
  return { doc, id };
};

describe("setMark", () => {
  it("schema §4.2: bold + color + highlight compose on one split run", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 8, 12, { type: "bold" });
    doc.setMark(id, 8, 12, { type: "color", value: "#0066CC" });
    doc.setMark(id, 8, 12, { type: "highlight", value: "#FFF3B0" });

    const expected = [
      { text: "Help us ", marks: {} },
      { text: "sync", marks: { bold: true, color: { value: "#0066CC" }, highlight: { value: "#FFF3B0" } } },
      { text: " faster!", marks: {} },
    ];
    expect(doc.getRuns(id)).toEqual(expected);
    expect(doc.toJSON().blocks[id]).toEqual({ type: "paragraph", content: expected });
  });

  it("an exclusive mark replaces the marks of covered runs", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 0, 8, { type: "bold" });
    doc.setMark(id, 0, 12, { type: "code" }); // over bold + plain
    expect(doc.getRuns(id)).toEqual([
      { text: "Help us sync", marks: { code: true } },
      { text: " faster!", marks: {} },
    ]);
  });

  it("a non-exclusive mark skips runs that carry an exclusive mark", () => {
    const doc = newDoc();
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "a", { bold: true });
    doc.insertText(id, 1, "b", { code: true });
    doc.insertText(id, 2, "c");
    doc.setMark(id, 0, 3, { type: "bold" });
    expect(doc.getRuns(id)).toEqual([
      { text: "a", marks: { bold: true } },
      { text: "b", marks: { code: true } },
      { text: "c", marks: { bold: true } },
    ]);
  });

  it("merges adjacent equal-mark runs lazily after setMark", () => {
    const doc = newDoc();
    const id = doc.insertBlock("paragraph");
    doc.insertText(id, 0, "abcdefghij");
    doc.setMark(id, 0, 5, { type: "bold" });
    doc.setMark(id, 5, 10, { type: "bold" });
    expect(doc.getRuns(id)).toEqual([{ text: "abcdefghij", marks: { bold: true } }]);
  });

  it("marks the whole text over the full range (0, total)", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 0, 20, { type: "bold" });
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: { bold: true } }]);
  });
});

describe("unsetMark", () => {
  it("removes only the named mark, keeping the others", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 8, 12, { type: "bold" });
    doc.setMark(id, 8, 12, { type: "color", value: "#0066CC" });
    doc.setMark(id, 8, 12, { type: "highlight", value: "#FFF3B0" });

    doc.unsetMark(id, 8, 12, "color");
    expect(doc.getRuns(id)).toEqual([
      { text: "Help us ", marks: {} },
      { text: "sync", marks: { bold: true, highlight: { value: "#FFF3B0" } } },
      { text: " faster!", marks: {} },
    ]);

    doc.unsetMark(id, 8, 12, "bold");
    expect(doc.getRuns(id)[1]).toEqual({ text: "sync", marks: { highlight: { value: "#FFF3B0" } } });

    doc.unsetMark(id, 8, 12, "highlight");
    // The middle run is plain again: all three runs merge lazily at read time.
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
  });
});

describe("mark command errors", () => {
  it("code block and non-text target -> InvalidOperationError", () => {
    const doc = newDoc();
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "abc");
    expect(() => doc.setMark(code, 0, 1, { type: "bold" })).toThrow(InvalidOperationError);
    const divider = doc.insertBlock("divider");
    expect(() => doc.setMark(divider, 0, 1, { type: "bold" })).toThrow(InvalidOperationError);
  });

  it("missing block -> UnknownBlockError", () => {
    expect(() => newDoc().setMark("nope", 0, 1, { type: "bold" })).toThrow(UnknownBlockError);
    expect(() => newDoc().unsetMark("nope", 0, 1, "bold")).toThrow(UnknownBlockError);
  });

  it("structurally invalid mark input -> InvalidMarkError", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 0, 1, { type: "color", value: "red" })).toThrow(InvalidMarkError);
    expect(() => doc.setMark(id, 0, 1, { type: "link", href: "javascript:alert(1)" })).toThrow(InvalidMarkError);
    expect(() => doc.unsetMark(id, 0, 1, "bogus" as MarkName)).toThrow(InvalidMarkError);
  });

  it("invalid ranges -> InvalidRangeError; from === to is a no-op", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 12, 8, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 0, 21, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, -1, 5, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 12, 8, "bold")).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 8, 8, { type: "bold" })).not.toThrow();
    expect(() => doc.unsetMark(id, 8, 8, "bold")).not.toThrow();
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
  });

  it("rejects a non-integer range without mutating the block", () => {
    const { doc, id } = markedDoc();
    const before = doc.encode().byteLength;
    expect(() => doc.setMark(id, 8, 12.5, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.setMark(id, 8.5, 12, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 8, 12.5, "bold")).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 8.5, 12, "bold")).toThrow(InvalidRangeError);
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
    expect(doc.encode().byteLength).toBe(before);
  });

  it("throws for an out-of-bounds from === to instead of no-op-ing", () => {
    const { doc, id } = markedDoc();
    expect(() => doc.setMark(id, 99, 99, { type: "bold" })).toThrow(InvalidRangeError);
    expect(() => doc.unsetMark(id, 99, 99, "bold")).toThrow(InvalidRangeError);
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: {} }]);
  });

  it("errors carry the offending block id and are DocBlocksError", () => {
    const { doc, id } = markedDoc();
    const error = expectThrows(() => doc.setMark(id, 0, 1, { type: "color", value: "red" }), InvalidMarkError);
    expect(error).toBeInstanceOf(DocBlocksError);
    expect(error.message).toContain(id);
  });
});
