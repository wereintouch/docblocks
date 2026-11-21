import { describe, expect, it } from "vitest";

import { createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "d", createdAt: CREATED_AT });

/** The fixture's document: one plain run "Help us sync faster!" (20 chars). */
const markedDoc = (): { doc: Doc; id: string } => {
  const doc = newDoc();
  const id = doc.insertBlock("paragraph");
  doc.insertText(id, 0, "Help us sync faster!");
  return { doc, id };
};

describe("setMark", () => {
  it("bold + color + highlight compose on one split run", () => {
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

  it("the mention mark: the id-only stand, combinable with bold", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 8, 12, { type: "mention", kind: "user", id: "u1" });
    doc.setMark(id, 8, 12, { type: "bold" });

    const runs = doc.getRuns(id);
    expect(runs).toEqual([
      { text: "Help us ", marks: {} },
      { text: "sync", marks: { mention: { kind: "user", id: "u1" }, bold: true } },
      { text: " faster!", marks: {} },
    ]);
    // Plain data: the mark value is a plain object in the JSON (the id-only
    // stand — the label is the run's text + the consumer's resolution).
    expect(doc.toJSON().blocks[id]).toEqual({ type: "paragraph", content: runs });
    // The mention composes over a run that already carries a mention (no error).
    doc.setMark(id, 8, 12, { type: "mention", kind: "doc", id: "d9" });
    expect(doc.getRuns(id)[1]?.marks.mention).toEqual({ kind: "doc", id: "d9" });
  });

  it("the legacy mention mark (the label snapshot's data) stands readable", () => {
    // The pre-id-only's data: the label snapshot is tolerated and ignored
    // (the lenient reader's stand — the strict validator accepts the form).
    const json = {
      v: 1,
      id: "doc-1",
      title: "",
      createdAt: "2026-10-10T00:00:00.000Z",
      blocks: {
        "doc-1": { type: "root", children: ["b1"] },
        b1: {
          type: "paragraph",
          content: [{ text: "Jane", marks: { mention: { kind: "user", id: "u1", label: "Jane" } } }],
        },
      },
    };
    const doc = fromJSON(json as never);
    expect(doc.getRuns("b1")).toEqual([
      { text: "Jane", marks: { mention: { kind: "user", id: "u1", label: "Jane" } } },
    ]);
  });

  it("marks the whole text over the full range (0, total)", () => {
    const { doc, id } = markedDoc();
    doc.setMark(id, 0, 20, { type: "bold" });
    expect(doc.getRuns(id)).toEqual([{ text: "Help us sync faster!", marks: { bold: true } }]);
  });

  it("the range stands the length contract: no text growth over a tail range (the Y.Text format's length argument)", () => {
    // The Y.Text format takes (start, length) — a `to` as the second argument
    // formats the from-anchored `to` characters and extends the text with line
    // breaks over the overhang. The ranges below stand from + to > total.
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "one two");

    // The non-exclusive set over the second word (the toolbar's mark apply).
    doc.setMark(p, 4, 7, { type: "bold" });
    expect(doc.getRuns(p)).toEqual([
      { text: "one ", marks: {} },
      { text: "two", marks: { bold: true } },
    ]);
    expect(doc.getTextLength(p)).toBe(7);

    // The exclusive set (code) over the same range: the overhang would
    // extend the text with four line breaks and code-mark them.
    doc.setMark(p, 0, 4, { type: "code" });
    expect(doc.getTextLength(p)).toBe(7);
    expect(doc.getRuns(p)).toEqual([
      { text: "one ", marks: { code: true } },
      { text: "two", marks: { bold: true } },
    ]);

    // A mid-text exclusive range stands the exact [from, to) bounds (no
    // over-marking of the tail characters).
    const p2 = doc.insertBlock("paragraph");
    doc.insertText(p2, 0, "hello world");
    doc.setMark(p2, 2, 6, { type: "code" });
    expect(doc.getTextLength(p2)).toBe(11);
    expect(doc.getRuns(p2)).toEqual([
      { text: "he", marks: {} },
      { text: "llo ", marks: { code: true } },
      { text: "world", marks: {} },
    ]);
  });

  it("a mention over a tail range stands the exact bounds (no over-marked tail run)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "open the doc");
    // "the" over (5, 8): from + to = 13 > 12 — the overhang range (the old
    // call formatted [5, 13) and over-marked the tail characters).
    doc.setMark(p, 5, 8, { type: "mention", kind: "doc", id: "d1" });
    expect(doc.getTextLength(p)).toBe(12);
    expect(doc.getRuns(p)).toEqual([
      { text: "open ", marks: {} },
      { text: "the", marks: { mention: { kind: "doc", id: "d1" } } },
      { text: " doc", marks: {} },
    ]);
  });
});

describe("unsetMark", () => {
  it("the toggle-off over a tail range stands the text (the set then the immediate unset)", () => {
    // The editor's mark toggle over the second word of a two-word block:
    // the set then the immediate unset. The unset's format range is the
    // length contract's pin — a `to` as the length extended the text with
    // line breaks over the overhang (the ghost lines' source).
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "one two");
    doc.setMark(p, 4, 7, { type: "bold" });
    doc.unsetMark(p, 4, 7, "bold");
    expect(doc.getText(p)).toBe("one two");
    expect(doc.getTextLength(p)).toBe(7);
    expect(doc.getRuns(p)).toEqual([{ text: "one two", marks: {} }]);

    // The strike parity over the same range.
    doc.setMark(p, 4, 7, { type: "strike" });
    doc.unsetMark(p, 4, 7, "strike");
    expect(doc.getText(p)).toBe("one two");

    // The exclusive toggle-off: the code mark set then unset over the range.
    doc.setMark(p, 4, 7, { type: "code" });
    doc.unsetMark(p, 4, 7, "code");
    expect(doc.getText(p)).toBe("one two");
    expect(doc.getTextLength(p)).toBe(7);
  });

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
