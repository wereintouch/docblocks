// @vitest-environment jsdom
/**
 * The link's range's reads + the doc's commands (the prefill's stand, the
 * caret's expansion, the apply / the removal over the single / the cross's
 * targets): the one-transaction's pins (one undo step over the whole
 * apply), the no-op's re-apply's stand, and the cross range's per-segment's
 * apply.
 */
import { describe, expect, it } from "vitest";

import { createDoc } from "docblocks-core";
import type { Doc } from "docblocks-core";

import { applyLinkHref, linkRangeOf, linkTargetOfCaret, removeLink, uniformLinkHrefOf } from "../src/editing/link";

const CREATED_AT = "2026-10-10T00:00:00.000Z";

function docWithText(text: string): { doc: Doc; blockId: string } {
  const doc = createDoc({ id: "link-actions-doc", createdAt: CREATED_AT });
  const blockId = doc.insertBlock("paragraph");
  doc.insertText(blockId, 0, text);
  return { doc, blockId };
}

describe("uniformLinkHrefOf", () => {
  it("the fully linked's range stands the href; the mixed's / the plain's stand `null`", () => {
    const { doc, blockId } = docWithText("plain linked plain");
    doc.setMark(blockId, 6, 12, { type: "link", href: "https://a.example" });
    const single = { kind: "single" as const, blockId, from: 6, to: 12 };
    expect(uniformLinkHrefOf(doc, single)).toBe("https://a.example");
    expect(uniformLinkHrefOf(doc, { kind: "single", blockId, from: 4, to: 8 })).toBeNull(); // the partial's stand
    expect(uniformLinkHrefOf(doc, { kind: "single", blockId, from: 0, to: 5 })).toBeNull(); // the plain's stand
  });

  it("the different hrefs' stand stands the mixed's `null`", () => {
    const { doc, blockId } = docWithText("aa bb");
    doc.setMark(blockId, 0, 2, { type: "link", href: "https://a.example" });
    doc.setMark(blockId, 3, 5, { type: "link", href: "https://b.example" });
    expect(uniformLinkHrefOf(doc, { kind: "single", blockId, from: 0, to: 5 })).toBeNull();
  });
});

describe("linkRangeOf (the caret's expansion)", () => {
  it("a caret inside the link stands the full's span; the plain's stand stands `null`", () => {
    const { doc, blockId } = docWithText("plain linked plain");
    doc.setMark(blockId, 6, 12, { type: "link", href: "https://a.example" });
    expect(linkRangeOf(doc, blockId, 8)).toEqual({ from: 6, to: 12, href: "https://a.example" });
    expect(linkRangeOf(doc, blockId, 1)).toBeNull();
  });

  it("the boundary's caret stands the left's stand: the link's start maps to the preceding's run, the end's caret expands", () => {
    const { doc, blockId } = docWithText("plain linked plain");
    doc.setMark(blockId, 6, 12, { type: "link", href: "https://a.example" });
    expect(linkRangeOf(doc, blockId, 6)).toBeNull(); // the start's boundary: the preceding's run's stand
    expect(linkRangeOf(doc, blockId, 12)).toEqual({ from: 6, to: 12, href: "https://a.example" });
  });

  it("the contiguous's same-href's runs stand the one's span; the different's href breaks the expansion", () => {
    const { doc, blockId } = docWithText("aaa bbb ccc");
    doc.setMark(blockId, 0, 3, { type: "link", href: "https://a.example" });
    doc.setMark(blockId, 4, 7, { type: "link", href: "https://a.example" });
    doc.setMark(blockId, 8, 11, { type: "link", href: "https://b.example" });
    expect(linkRangeOf(doc, blockId, 1)).toEqual({ from: 0, to: 3, href: "https://a.example" });
    expect(linkRangeOf(doc, blockId, 5)).toEqual({ from: 4, to: 7, href: "https://a.example" });
    expect(linkRangeOf(doc, blockId, 9)).toEqual({ from: 8, to: 11, href: "https://b.example" });
  });
});

describe("linkTargetOfCaret", () => {
  it("a caret inside a link stands the link's range; otherwise the caret's own insertion's target", () => {
    const { doc, blockId } = docWithText("plain linked plain");
    doc.setMark(blockId, 6, 12, { type: "link", href: "https://a.example" });
    expect(linkTargetOfCaret(doc, { blockId, offset: 8 })).toEqual({ kind: "single", blockId, from: 6, to: 12 });
    expect(linkTargetOfCaret(doc, { blockId, offset: 2 })).toEqual({ kind: "single", blockId, from: 2, to: 2 });
  });
});

describe("applyLinkHref / removeLink", () => {
  it("the single's range's apply stands the mark (one undo step)", () => {
    const { doc, blockId } = docWithText("hello world");
    applyLinkHref(doc, { kind: "single", blockId, from: 6, to: 11 }, "https://example.org");
    expect(doc.getRuns(blockId)).toEqual([
      { text: "hello ", marks: {} },
      { text: "world", marks: { link: { href: "https://example.org" } } },
    ]);
    doc.undo();
    expect(doc.getRuns(blockId)).toEqual([{ text: "hello world", marks: {} }]);
  });

  it("the same href's re-apply stands the no-op (the undo's chain's stand)", () => {
    const { doc, blockId } = docWithText("hello world");
    applyLinkHref(doc, { kind: "single", blockId, from: 6, to: 11 }, "https://example.org");
    const before = JSON.stringify(doc.toJSON());
    applyLinkHref(doc, { kind: "single", blockId, from: 6, to: 11 }, "https://example.org");
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });

  it("a caret's apply inserts the label's text as the linked's run (one undo step)", () => {
    const { doc, blockId } = docWithText("go ");
    applyLinkHref(doc, { kind: "single", blockId, from: 3, to: 3 }, "https://example.org", "example.org");
    expect(doc.getText(blockId)).toBe("go example.org");
    expect(doc.getRuns(blockId)).toEqual([
      { text: "go ", marks: {} },
      { text: "example.org", marks: { link: { href: "https://example.org" } } },
    ]);
    doc.undo();
    expect(doc.getText(blockId)).toBe("go ");
  });

  it("the cross's range's apply stands the mark over every segment (one undo step)", () => {
    const doc = createDoc({ id: "link-actions-cross", createdAt: CREATED_AT });
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    doc.insertText(a, 0, "first block text");
    doc.insertText(b, 0, "second block text");
    const cross = {
      from: { blockId: a, offset: 6 },
      to: { blockId: b, offset: 7 },
      chain: [a, b],
    };
    applyLinkHref(doc, { kind: "cross", cross }, "https://example.org");
    expect(doc.getRuns(a)).toEqual([
      { text: "first ", marks: {} },
      { text: "block text", marks: { link: { href: "https://example.org" } } },
    ]);
    expect(doc.getRuns(b)).toEqual([
      { text: "second ", marks: { link: { href: "https://example.org" } } },
      { text: "block text", marks: {} },
    ]);
    doc.undo();
    expect(doc.getRuns(a)).toEqual([{ text: "first block text", marks: {} }]);
    expect(doc.getRuns(b)).toEqual([{ text: "second block text", marks: {} }]);
  });

  it("the removal stands the mark's off (one undo step, the text's stand)", () => {
    const { doc, blockId } = docWithText("hello world");
    doc.setMark(blockId, 6, 11, { type: "link", href: "https://example.org" });
    removeLink(doc, { kind: "single", blockId, from: 6, to: 11 });
    expect(doc.getRuns(blockId)).toEqual([{ text: "hello world", marks: {} }]);
    doc.undo();
    expect(doc.getRuns(blockId)[1]!.marks.link).toEqual({ href: "https://example.org" });
  });
});
