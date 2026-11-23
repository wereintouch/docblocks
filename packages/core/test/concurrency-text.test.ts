import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/** Full bidirectional exchange: each side applies what the other is missing (A→B then B→A). */
const exchange = (a: Doc, b: Doc): void => {
  b.applyUpdate(deltaOf(a, b));
  a.applyUpdate(deltaOf(b, a));
};

/**
 * Concurrent formatting and text edits over a shared paragraph. The text
 * is a single Y.Text with mark attributes, so formatting is a pure attribute
 * operation (no text copy) and character identity survives concurrent
 * formatting and deletion. These are theacceptance criteria: the text
 * stays intact, the converged state reloads, and re-delivery is idempotent.
 */
describe("concurrent formatting and text edits keep the text valid", () => {
  const seed = (id: string): { a: Doc; blockId: string } => {
    const a = createDoc({ id, createdAt: CREATED_AT, generateId: makeIds(id) });
    const blockId = a.insertBlock("paragraph");
    a.insertText(blockId, 0, "abcdef");
    return { a, blockId };
  };
  const fork = (d: Doc): Doc => loadDoc(d.encode());

  it("concurrent bold + italic keep the text intact (a->b delivery)", () => {
    const { a, blockId } = seed("text-fmt");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    b.setMark(blockId, 2, 5, { type: "italic" });
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcdef");
    expect(b.getText(blockId)).toBe("abcdef");
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(validateDoc(a.toJSON())).toEqual([]);
  });

  it("concurrent formatting + deletion keep the text valid", () => {
    const { a, blockId } = seed("text-del");
    const b = fork(a);
    // A bolds [3,6); B deletes [4,6) ("ef").
    a.setMark(blockId, 3, 6, { type: "bold" });
    b.deleteText(blockId, 4, 6);
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcd");
    expect(b.getText(blockId)).toBe("abcd");
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("concurrent formatting + insertion keep the text valid", () => {
    const { a, blockId } = seed("text-ins");
    const b = fork(a);
    // A bolds [0,3); B inserts "XY" at 3.
    a.setMark(blockId, 0, 3, { type: "bold" });
    b.insertText(blockId, 3, "XY");
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcXYdef");
    expect(b.getText(blockId)).toBe("abcXYdef");
    expect(a.toJSON()).toEqual(b.toJSON());
  });

  it("undo/redo of a format over a remote edit keeps the text valid", () => {
    const { a, blockId } = seed("text-undo");
    const b = fork(a);
    a.setMark(blockId, 0, 6, { type: "bold" });
    b.insertText(blockId, 6, "!");
    exchange(a, b);
    expect(a.getText(blockId)).toBe("abcdef!");
    a.undo(); // undo the bold
    expect(a.getText(blockId)).toBe("abcdef!");
    expect(a.getRuns(blockId).every((run) => run.marks.bold === undefined)).toBe(true);
    a.redo(); // redo the bold
    expect(a.getText(blockId)).toBe("abcdef!");
    expect(a.getRuns(blockId).some((run) => run.marks.bold === true)).toBe(true);
  });

  it("re-delivery of the same update is idempotent", () => {
    const { a, blockId } = seed("text-redeliver");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    const update = a.encode();
    b.applyUpdate(update);
    b.applyUpdate(update); // the same update twice
    expect(b.getText(blockId)).toBe("abcdef");
    expect(b.toJSON()).toEqual(loadDoc(update).toJSON());
  });

  it("the merged state reloads as a valid snapshot", () => {
    const { a, blockId } = seed("text-reload");
    const b = fork(a);
    a.setMark(blockId, 1, 4, { type: "bold" });
    b.setMark(blockId, 2, 5, { type: "italic" });
    exchange(a, b);
    const reloaded = loadDoc(a.encode());
    expect(reloaded.getText(blockId)).toBe("abcdef");
    expect(validateDoc(reloaded.toJSON())).toEqual([]);
    expect(reloaded.toJSON()).toEqual(a.toJSON());
  });
});
