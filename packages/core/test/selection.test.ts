import { describe, expect, it } from "vitest";

import { InvalidSelectionError, createDoc, createSelection, loadDoc } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * SelectionView basics: set/get/onChange, validation (InvalidSelectionError),
 * no document side effects, plainness of the snapshots, per-view independence.
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

/** Narrow a blocks selection for assertions (get() returns the union). */
const asBlocks = (s: Selection): Extract<Selection, { kind: "blocks" }> => {
  if (s.kind !== "blocks") throw new Error(`expected a blocks selection, got ${s.kind}`);
  return s;
};

/** A doc with one paragraph "hello world" (id "b0"). */
const withParagraph = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  doc.insertText("b0", 0, "hello world");
  return doc;
};

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

describe("set / get / onChange", () => {
  it("stores a caret (to: null) with the engine-filled single-block chain", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    expect(sel.get()).toEqual({ kind: "none" });
    sel.set(caret("b0", 3));

    expect(sel.get()).toEqual({ kind: "text", from: { blockId: "b0", offset: 3 }, to: null, blocks: ["b0"] });
  });

  it("stores a range with blocks omitted by the caller and filled by the engine", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set({ kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: "b0", offset: 5 } });

    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 0 },
      to: { blockId: "b0", offset: 5 },
      blocks: ["b0"],
    });
  });

  it("stores a blocks selection and preserves the anchor", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set({ kind: "blocks", ids: ["b0", doc.meta.id], anchorId: doc.meta.id });

    expect(sel.get()).toEqual({ kind: "blocks", ids: ["b0", doc.meta.id], anchorId: doc.meta.id });
  });

  it("keeps the reverse flag when provided and drops it when absent", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    sel.set({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b0", offset: 5 },
      reverse: true,
    });
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 2 },
      to: { blockId: "b0", offset: 5 },
      blocks: ["b0"],
      reverse: true,
    });

    sel.set({ kind: "text", from: { blockId: "b0", offset: 1 }, to: { blockId: "b0", offset: 4 } });
    expect(asText(sel.get()).reverse).toBeUndefined();
  });

  it("fires onChange with the new state on set — even when identical", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    const seen: Selection[] = [];
    const off = sel.onChange((s) => seen.push(s));

    sel.set(caret("b0", 1));
    sel.set(caret("b0", 1)); // identical: still emits

    expect(seen).toEqual([caret("b0", 1), caret("b0", 1)]);
    off();
  });

  it("get() returns a fresh plain snapshot on every call", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    sel.set({ kind: "blocks", ids: ["b0", doc.meta.id], anchorId: "b0" });

    const a = asBlocks(sel.get());
    const b = sel.get();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);

    a.ids.push("mutated");
    a.anchorId = "mutated";
    expect(sel.get()).toEqual({ kind: "blocks", ids: ["b0", doc.meta.id], anchorId: "b0" });
  });

  it("unsubscribe stops delivery and is safe to call twice", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);
    let fired = 0;
    const off = sel.onChange(() => fired++);

    sel.set(caret("b0", 0));
    expect(fired).toBe(1);

    off();
    off();
    sel.set(caret("b0", 1));
    expect(fired).toBe(1);
  });
});

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

describe("no document side effects", () => {
  it("set() does not change encode(), toJSON(), or the undo history", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    const encoded = doc.encode();
    const json = doc.toJSON();
    const canUndo = doc.canUndo;
    const canRedo = doc.canRedo;
    const docChanges: unknown[] = [];
    const off = doc.onChange((change) => docChanges.push(change));

    sel.set(caret("b0", 4));
    sel.set({ kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: "b0", offset: 9 } });
    sel.set({ kind: "none" });

    expect(bytesEqual(doc.encode(), encoded)).toBe(true);
    expect(doc.toJSON()).toEqual(json);
    expect(doc.canUndo).toBe(canUndo);
    expect(doc.canRedo).toBe(canRedo);
    expect(docChanges).toEqual([]);
    off();
  });

  it("set() between edits does not create an undo step", () => {
    const doc = loadDoc(withParagraph().encode());
    const sel = createSelection(doc);
    expect(doc.canUndo).toBe(false);

    doc.insertText("b0", 0, "A");
    expect(doc.canUndo).toBe(true);

    sel.set(caret("b0", 1));
    expect(doc.canUndo).toBe(true); // set() adds no step

    doc.undo();
    // Exactly the one local edit was undone (no extra step from set()).
    expect(doc.getText("b0")).toBe("hello world");
    expect(doc.canUndo).toBe(false);
  });
});

describe("plainness", () => {
  it("get() round-trips through JSON for every kind", () => {
    const doc = withParagraph();
    const sel = createSelection(doc);

    const states: Selection[] = [
      { kind: "none" },
      caret("b0", 3),
      { kind: "text", from: { blockId: "b0", offset: 0 }, to: { blockId: "b0", offset: 5 }, reverse: true },
      { kind: "blocks", ids: ["b0", doc.meta.id], anchorId: "b0" },
    ];
    for (const state of states) {
      sel.set(state);
      const snap = sel.get();
      expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
      expect(snap).toEqual(sel.get());
    }
  });
});

describe("per-view independence", () => {
  it("two views on one doc are independent (set and rebase)", () => {
    const doc = withParagraph();
    const a = createSelection(doc);
    const b = createSelection(doc);
    const aSeen: Selection[] = [];
    const bSeen: Selection[] = [];
    const offA = a.onChange((s) => aSeen.push(s));
    const offB = b.onChange((s) => bSeen.push(s));

    a.set(caret("b0", 2));
    expect(aSeen).toEqual([caret("b0", 2)]);
    expect(bSeen).toEqual([]);
    expect(b.get()).toEqual({ kind: "none" });

    // A doc change rebases both views independently.
    doc.insertText("b0", 0, "XY"); // caret @2 in b0 shifts to @4 in both
    expect(asText(a.get()).from.offset).toBe(4);
    expect(b.get()).toEqual({ kind: "none" }); // b has no selection: nothing to rebase
    expect(bSeen).toEqual([]);

    b.set(caret("b0", 1));
    doc.deleteText("b0", 0, 2);
    expect(asText(a.get()).from.offset).toBe(2);
    expect(asText(b.get()).from.offset).toBe(0);

    offA();
    offB();
  });
});
