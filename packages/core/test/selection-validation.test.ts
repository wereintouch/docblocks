import { describe, expect, it } from "vitest";

import { InvalidSelectionError, createDoc, createSelection } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * SelectionView's validation (the sibling of selection.test.ts): the
 * InvalidSelectionError's rejections over the set's input.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const caret = (blockId: string, offset: number): Selection => ({
  kind: "text",
  from: { blockId, offset },
  to: null,
  // The engine fills the chain; set() validates it, so the same shape doubles as the expected state.
  blocks: [blockId],
});

/** Narrow a text selection for assertions (get() returns the union). */
const asText = (s: Selection): Extract<Selection, { kind: "text" }> => {
  if (s.kind !== "text") throw new Error(`expected a text selection, got ${s.kind}`);
  return s;
};

/** A doc with one paragraph "hello world" (id "b0"). */
const withParagraph = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  doc.insertText("b0", 0, "hello world");
  return doc;
};

describe("validation (InvalidSelectionError)", () => {
  it("rejects an unknown from block", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    expect(() => sel.set(caret("nope", 0))).toThrow(InvalidSelectionError);
  });

  it("rejects an unknown to block", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    expect(() =>
      sel.set({ kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: "nope", offset: 0 } })
    ).toThrow(InvalidSelectionError);
  });

  it("rejects a text selection on a non-text block (image, table)", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    const image = doc.insertBlock("image", { src: "blobs/x.png" });
    const table = doc.insertBlock("table", { cols: 2 });

    expect(() => sel.set(caret(image, 0))).toThrow(InvalidSelectionError);
    expect(() => sel.set(caret(table, 0))).toThrow(InvalidSelectionError);
    expect(() =>
      sel.set({ kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: image, offset: 0 } })
    ).toThrow(InvalidSelectionError);
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("rejects offsets outside [0, textLength] and non-integers", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    expect(() => sel.set(caret("b0", 12))).toThrow(InvalidSelectionError); // length is 11
    expect(() => sel.set(caret("b0", -1))).toThrow(InvalidSelectionError);
    expect(() => sel.set(caret("b0", 1.5))).toThrow(InvalidSelectionError);
    expect(() =>
      sel.set({ kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: "b0", offset: 99 } })
    ).toThrow(InvalidSelectionError);
  });

  it("rejects a cross-block chain that does not match the DFS order", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    const b1 = doc.insertBlock("paragraph");

    const valid: Extract<Selection, { kind: "text" }> = {
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: b1, offset: 0 },
    };
    expect(() => sel.set({ ...valid, blocks: [b1, "b0"] })).toThrow(InvalidSelectionError);
    expect(() => sel.set({ ...valid, blocks: ["b0", "b0"] })).toThrow(InvalidSelectionError);

    // The matching chain is accepted; without a chain the engine computes it.
    sel.set({ ...valid, blocks: ["b0", b1] });
    expect(sel.get()).toMatchObject({ from: { blockId: "b0" }, to: { blockId: b1 }, blocks: ["b0", b1] });
    sel.set(valid);
    expect(asText(sel.get()).blocks).toEqual(["b0", b1]);
  });

  it("rejects malformed blocks selections (empty ids, missing/unknown anchor, unknown id)", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    expect(() => sel.set({ kind: "blocks", ids: [], anchorId: "b0" })).toThrow(InvalidSelectionError);
    expect(() => sel.set({ kind: "blocks", ids: ["b0"], anchorId: "b1" })).toThrow(InvalidSelectionError);
    expect(() => sel.set({ kind: "blocks", ids: ["b0", "nope"], anchorId: "b0" })).toThrow(InvalidSelectionError);
    expect(sel.get()).toEqual({ kind: "none" });
  });

  it("rejects an unknown kind and keeps the previous state", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    sel.set(caret("b0", 2));

    expect(() => sel.set({ kind: "bogus" } as unknown as Selection)).toThrow(InvalidSelectionError);
    expect(sel.get()).toEqual({ kind: "text", from: { blockId: "b0", offset: 2 }, to: null, blocks: ["b0"] });
  });
});
