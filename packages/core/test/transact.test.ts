import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import { localOriginOf } from "../src/core/layout";

/**
 * Doc.transact: one local transaction = one Yjs update on the wire and one
 * undo step, however many commands it batches. A failing fn rolls the
 * batch back (this Yjs build has no transaction abort) and rethrows.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

/** Deterministic block id generator. */
const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A fresh doc with one empty paragraph (id "b0"). */
const withParagraph = (): { doc: Doc; paragraph: string } => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  return { doc, paragraph: "b0" };
};

const countUpdates = (doc: Doc): (() => number) => {
  let updates = 0;
  doc.raw.on("update", () => updates++);
  return () => updates;
};

describe("transact batching", () => {
  it("batches 3 commands into one update and one undo step", () => {
    const { doc, paragraph } = withParagraph();
    const before = doc.toJSON();
    const updates = countUpdates(doc);

    doc.transact(() => {
      doc.insertText(paragraph, 0, "hello ");
      doc.insertText(paragraph, 6, "world");
      doc.setMark(paragraph, 0, 5, { type: "bold" });
    });

    expect(updates()).toBe(1);
    expect(doc.getText(paragraph)).toBe("hello world");

    // One undo step: reverts all three commands at once.
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("the same 3 commands outside transact are 3 updates and 3 undo steps", () => {
    const { doc, paragraph } = withParagraph();
    const before = doc.toJSON();
    const updates = countUpdates(doc);

    doc.insertText(paragraph, 0, "hello ");
    doc.insertText(paragraph, 6, "world");
    doc.setMark(paragraph, 0, 5, { type: "bold" });

    expect(updates()).toBe(3);

    doc.undo();
    expect(doc.getText(paragraph)).toBe("hello world"); // bold gone
    doc.undo();
    expect(doc.getText(paragraph)).toBe("hello ");
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    expect(doc.canUndo).toBe(true); // only the setup step remains
  });
});

describe("transact atomicity", () => {
  /** The doc after the setup step is undone: the root-only page. */
  const rootOnly = {
    v: 1,
    id: "d1",
    title: "",
    createdAt: CREATED_AT,
    blocks: { d1: { type: "root", children: [] } },
  };

  it("rolls back a batch when fn throws mid-way and rethrows the error", () => {
    const { doc, paragraph } = withParagraph();
    const before = doc.toJSON();

    expect(() =>
      doc.transact(() => {
        doc.insertText(paragraph, 0, "abc");
        throw new Error("boom");
      })
    ).toThrow("boom");

    // The partial write is rolled back; the stack holds only the setup step
    // and nothing was pushed to the redo stack by the rollback.
    expect(doc.toJSON()).toEqual(before);
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.toJSON()).toEqual(rootOnly);
    expect(doc.canUndo).toBe(false);
  });

  it("rolls back the batch when a command throws during validation", () => {
    const { doc, paragraph } = withParagraph();
    const before = doc.toJSON();

    expect(() =>
      doc.transact(() => {
        doc.insertText(paragraph, 0, "abc");
        doc.insertText(paragraph, 99, "z"); // InvalidRangeError
      })
    ).toThrow();

    // The first command's write is part of the batch and is rolled back too.
    expect(doc.toJSON()).toEqual(before);
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.toJSON()).toEqual(rootOnly);
  });

  it("rolls back a batch whose fn throws before any command runs", () => {
    const { doc } = withParagraph();
    const before = doc.toJSON();

    expect(() =>
      doc.transact(() => {
        throw new Error("early");
      })
    ).toThrow("early");

    expect(doc.toJSON()).toEqual(before);
    expect(doc.canUndo).toBe(true);
    expect(doc.canRedo).toBe(false);
    doc.undo();
    expect(doc.toJSON()).toEqual(rootOnly);
  });

  it("keeps a completed transact atomic across later failures of sibling transactions", () => {
    const { doc, paragraph } = withParagraph();
    const before = doc.toJSON();

    doc.transact(() => {
      doc.insertText(paragraph, 0, "kept");
    });
    expect(doc.getText(paragraph)).toBe("kept");

    // A later failing batch must not disturb the committed one.
    expect(() =>
      doc.transact(() => {
        doc.insertText(paragraph, 4, "lost");
        throw new Error("later");
      })
    ).toThrow("later");

    expect(doc.getText(paragraph)).toBe("kept");
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("drops the failed batch's inverse step from the redo stack after an earlier undo", () => {
    const { doc, paragraph } = withParagraph();

    // Build a non-empty redo stack before the failing batch.
    doc.insertText(paragraph, 0, "abc");
    doc.undo();
    expect(doc.canRedo).toBe(true);

    expect(() =>
      doc.transact(() => {
        doc.insertText(paragraph, 0, "xyz");
        throw new Error("boom");
      })
    ).toThrow("boom");

    // The batch is rolled back and its inverse step is dropped from the redo
    // stack: redo must not resurrect "xyz".
    expect(doc.getText(paragraph)).toBe("");
    expect(doc.canRedo).toBe(false);
    doc.redo(); // safe no-op
    expect(doc.getText(paragraph)).toBe("");
    // The pre-failure undo stack is intact: only the setup step remains.
    expect(doc.canUndo).toBe(true);
    doc.undo();
    expect(doc.toJSON()).toEqual(rootOnly);
  });
});

describe("update event shape", () => {
  it("emits the batch update with the local origin and once on the wire", () => {
    const { doc } = withParagraph();
    const seen: Array<{ length: number; origin: unknown }> = [];
    doc.raw.on("update", (update, origin) => seen.push({ length: update.byteLength, origin }));

    doc.transact(() => {
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.length).toBeGreaterThan(0);
    expect(seen[0]?.origin).toBe(localOriginOf(doc.raw));
  });
});
