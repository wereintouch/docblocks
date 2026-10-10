import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import { fixture } from "./fixtures";

/**
 * Undo/redo (y-undo UndoManager, local origin only, captureTimeout 0).
 * Remote and loaded state never enter the history; undo never reverts
 * remote changes (api-v1 §6.3).
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A shared base state: one empty paragraph (id "b0"), imported by both peers. */
const baseState = (): Uint8Array => {
  const base = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  base.insertBlock("paragraph");
  return base.encode();
};

describe("undo/redo basics", () => {
  it("walks an insert + text + mark sequence back and forth with exact snapshots", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const s0 = doc.toJSON();
    const paragraph = doc.insertBlock("paragraph");
    const s1 = doc.toJSON();
    doc.insertText(paragraph, 0, "hello world");
    const s2 = doc.toJSON();
    doc.setMark(paragraph, 0, 5, { type: "bold" });
    const s3 = doc.toJSON();

    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);

    doc.undo();
    expect(doc.toJSON()).toEqual(s2);
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(true);

    doc.undo();
    expect(doc.toJSON()).toEqual(s1);
    doc.undo();
    expect(doc.toJSON()).toEqual(s0);
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(true);

    // Redo forward: the redone steps go back to the undo stack, so after a
    // full redo canUndo is true again and canRedo is false.
    doc.redo();
    expect(doc.toJSON()).toEqual(s1);
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(true);

    doc.redo();
    expect(doc.toJSON()).toEqual(s2);
    doc.redo();
    expect(doc.toJSON()).toEqual(s3);
    expect(doc.canRedo).toBe(false);
    expect(doc.canUndo).toBe(true);
  });

  it("undo and redo are safe no-ops on empty stacks", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT });
    expect(doc.canUndo).toBe(false);
    expect(doc.canRedo).toBe(false);
    const before = doc.toJSON();
    doc.undo();
    doc.redo();
    expect(doc.toJSON()).toEqual(before);
  });
});

describe("undo never reverts remote or loaded state", () => {
  it("initial and loaded state is not undoable", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT });
    expect(doc.canUndo).toBe(false);
    const before = doc.toJSON();
    doc.undo(); // safe no-op
    expect(doc.toJSON()).toEqual(before);

    const loaded = fromJSON(fixture);
    expect(loaded.canUndo).toBe(false);
    loaded.undo();
    loaded.redo();
    expect(loaded.toJSON()).toEqual(fixture);
  });

  it("a remote update does not pollute the undo stack", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    expect(doc1.canUndo).toBe(false);

    doc2.insertText("b0", 0, "B");
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));

    expect(doc1.getText("b0")).toBe("B");
    expect(doc1.canUndo).toBe(false);
    expect(doc1.canRedo).toBe(false);
  });

  it("undo reverts the local edit but keeps the concurrent remote edit", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);

    doc1.insertText("b0", 0, "A");
    doc2.insertText("b0", 0, "B");

    // doc1 receives doc2's delta (the classic §6.3 scenario).
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));
    expect(doc1.canUndo).toBe(true);

    doc1.undo();

    // A is undone, B stays: doc1 converges exactly to doc2's state.
    expect(doc1.getText("b0")).toBe("B");
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });

  it("a local edit after a remote update undoes only the local edit", () => {
    const state = baseState();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);

    doc2.insertText("b0", 0, "B");
    doc1.applyUpdate(doc2.encodeUpdate(Y.encodeStateVector(doc1.raw)));
    doc1.insertText("b0", 1, "A");

    doc1.undo();

    expect(doc1.getText("b0")).toBe("B");
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });
});
