// @vitest-environment jsdom
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { caretAtFlat, key, rangeAtFlat, renderDoc, wrapperOf } from "./keyboard.helpers";

describe("format shortcuts", () => {
  it("mod+b bolds the selected range; a second mod+b unsets it; one undo step each", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    // Select "ell" (flat offsets 1..4) and bold it.
    rangeAtFlat(p, 1, 4);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "h", marks: {} },
      { text: "ell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);

    // The selection survived the store-driven change: the second mod+b over
    // the same range unsets the mark.
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);

    // One undo step per toggle.
    expect(doc.canUndo).toBe(true);
    act(() => {
      doc.undo();
    });
    expect(doc.getRuns(p)).toEqual([
      { text: "h", marks: {} },
      { text: "ell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);
    act(() => {
      doc.undo();
    });
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);
  });

  it("a partially bold range toggles to set", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
      d.setMark(p, 0, 3, { type: "bold" }); // "hel" bold, "lo" plain
    });

    // "ell" (flat offsets 1..4) is only partly bold: the toggle sets, and
    // the set extends over the whole range (the pre-bolded head keeps it).
    rangeAtFlat(p, 1, 4);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hell", marks: { bold: true } },
      { text: "o", marks: {} },
    ]);
  });

  it("mod+shift+x strikes, and other marks follow the same shortcut scheme", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    rangeAtFlat(p, 0, 3);
    expect(key(wrapperOf(p), { key: "x", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hel", marks: { strike: true } },
      { text: "lo", marks: {} },
    ]);

    rangeAtFlat(p, 3, 5);
    expect(key(wrapperOf(p), { key: "i", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p)).toEqual([
      { text: "hel", marks: { strike: true } },
      { text: "lo", marks: { italic: true } },
    ]);
  });

  it("a collapsed caret is a no-op, with the default suppressed", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "hello");
    });

    caretAtFlat(p, 2);
    expect(key(wrapperOf(p), { key: "b", ctrlKey: true })).toBe(false); // suppressed
    expect(doc.getRuns(p)).toEqual([{ text: "hello", marks: {} }]);
  });

  it("does not toggle marks over a selection outside the block", () => {
    let p1: BlockId = "";
    let p2: BlockId = "";
    const doc = renderDoc((d) => {
      p1 = d.insertBlock("paragraph");
      d.insertText(p1, 0, "one");
      p2 = d.insertBlock("paragraph");
      d.insertText(p2, 0, "two");
    });

    // The selection sits in p2; the shortcut on the p1 wrapper is a no-op
    // (no marks applied) but suppresses the default so the browser's native
    // formatting cannot diverge the document DOM over the cross-block range.
    rangeAtFlat(p2, 0, 2);
    expect(key(wrapperOf(p1), { key: "b", ctrlKey: true })).toBe(false);
    expect(doc.getRuns(p2)).toEqual([{ text: "two", marks: {} }]);
  });
});
