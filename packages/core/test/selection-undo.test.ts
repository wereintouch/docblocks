import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, createSelection, loadDoc } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * Undo/redo restores the local selection (spec selection-v1 §5,
 * ProseMirror semantics): each captured local edit snapshots the selection
 * it started from; undo/redo overwrite the rebased selection with that
 * snapshot (restoration wins). Remote changes never restore — rebase only.
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

/** A doc with one paragraph "abc" (id "b0"). */
const withText = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  doc.insertText("b0", 0, "abc");
  return doc;
};

/** The shared base state for two-peer scenarios. */
const baseState = (): Uint8Array => withText().encode();

describe("undo/redo restores the local caret", () => {
  it("undo restores the pre-edit caret, redo restores it forward", () => {
    const doc = withText();
    const sel = createSelection(doc);

    sel.set(caret("b0", 1));
    doc.insertText("b0", 1, "X"); // "aXbc"
    sel.set(caret("b0", 2)); // the UI moves the caret after the typed char
    doc.insertText("b0", 2, "Y"); // "aXYbc"
    sel.set(caret("b0", 3));

    doc.undo();
    expect(doc.getText("b0")).toBe("aXbc");
    expect(sel.get()).toEqual(caret("b0", 2)); // exactly the pre-edit caret

    doc.redo();
    expect(doc.getText("b0")).toBe("aXYbc");
    expect(sel.get()).toEqual(caret("b0", 3)); // restored forward

    // The cycle is repeatable: undo/redo of the same step keep alternating.
    doc.undo();
    expect(sel.get()).toEqual(caret("b0", 2));
    doc.redo();
    expect(sel.get()).toEqual(caret("b0", 3));
  });

  it("restores the pre-edit caret of the FIRST edit over a full history", () => {
    const doc = withText();
    const sel = createSelection(doc);

    sel.set(caret("b0", 1));
    doc.insertText("b0", 1, "X");
    sel.set(caret("b0", 2));
    doc.insertText("b0", 2, "Y");
    sel.set(caret("b0", 3));

    doc.undo();
    doc.undo();
    expect(doc.getText("b0")).toBe("abc");
    expect(sel.get()).toEqual(caret("b0", 1)); // the caret before the first edit
  });

  it("undo restores the exact pre-edit RANGE (restoration is not re-rebased)", () => {
    const doc = withText(); // "abc"
    doc.insertText("b0", 3, "def"); // "abcdef"
    const sel = createSelection(doc);

    sel.set({ kind: "text", from: { blockId: "b0", offset: 1 }, to: { blockId: "b0", offset: 3 }, blocks: ["b0"] });
    doc.deleteText("b0", 1, 3); // "adef": the range collapses to a caret at 1
    expect(doc.getText("b0")).toBe("adef");

    doc.undo(); // "abcdef": the pre-edit range must come back exactly
    expect(doc.getText("b0")).toBe("abcdef");
    expect(sel.get()).toEqual({
      kind: "text",
      from: { blockId: "b0", offset: 1 },
      to: { blockId: "b0", offset: 3 },
      blocks: ["b0"],
    });
  });

  it("emits the restored selection through onChange", () => {
    const doc = withText();
    const sel = createSelection(doc);

    sel.set(caret("b0", 1));
    doc.insertText("b0", 1, "X");
    sel.set(caret("b0", 2));

    const seen: Selection[] = [];
    const off = sel.onChange((s) => seen.push(s));

    doc.undo();
    expect(seen.at(-1)).toEqual(caret("b0", 1));

    doc.redo();
    expect(seen.at(-1)).toEqual(caret("b0", 2));
    off();
  });

  it("does not restore an edit captured before the view existed (rebase stands)", () => {
    const doc = withText();

    doc.insertText("b0", 0, "Z"); // "Zabc" — captured without a selection view
    const sel = createSelection(doc);
    sel.set(caret("b0", 1));
    doc.insertText("b0", 1, "W"); // "ZWabc"
    sel.set(caret("b0", 2));

    doc.undo();
    expect(doc.getText("b0")).toBe("Zabc");
    expect(sel.get()).toEqual(caret("b0", 1)); // restored (the view was alive)

    doc.undo();
    expect(doc.getText("b0")).toBe("abc");
    // No snapshot for the first edit: the rebased caret stands (1 - 1 = 0).
    expect(sel.get()).toEqual(caret("b0", 0));
  });

  it("undo of a local edit keeps the caret restoration independent of concurrent remote edits", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    const sel = createSelection(doc1);

    sel.set(caret("b0", 1));
    doc1.insertText("b0", 1, "X"); // "aXbc"
    sel.set(caret("b0", 2));

    doc2.insertText("b0", 0, "Z"); // remote edit: "Zabc"
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));
    expect(doc1.getText("b0")).toBe("ZaXbc");
    expect(sel.get()).toEqual(caret("b0", 3)); // rebased (2 + 1)

    doc1.undo();
    expect(doc1.getText("b0")).toBe("Zabc"); // the remote edit survives the undo
    expect(sel.get()).toEqual(caret("b0", 1)); // the pre-local-edit caret is restored
  });
});

describe("remote changes never restore", () => {
  it("a remote edit rebases the selection and leaves the undo history untouched", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    const sel = createSelection(doc1);
    sel.set(caret("b0", 1));

    doc2.insertText("b0", 0, "Z");
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));

    expect(doc1.getText("b0")).toBe("Zabc");
    expect(sel.get()).toEqual(caret("b0", 2)); // shifted by the rebase, not restored
    expect(doc1.canUndo).toBe(false); // no local edit: nothing captured
    expect(doc1.canRedo).toBe(false);

    // undo/redo are no-ops for the selection (no stack items).
    doc1.undo();
    doc1.redo();
    expect(sel.get()).toEqual(caret("b0", 2));
  });

  it("two views on one doc: a remote edit rebases both, none restores", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    const a = createSelection(doc1);
    const b = createSelection(doc1);
    a.set(caret("b0", 0));
    b.set(caret("b0", 1));

    doc2.deleteText("b0", 2, 3); // drop "c"
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));

    expect(doc1.getText("b0")).toBe("ab");
    expect(a.get()).toEqual(caret("b0", 0));
    expect(b.get()).toEqual(caret("b0", 1));
    expect(doc1.canUndo).toBe(false);
  });
});
