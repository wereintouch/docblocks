import { describe, expect, it } from "vitest";

import { DestroyedViewError, createDoc, createSelection } from "../src/core";
import type { Doc, Selection } from "../src/core";

/**
 * SelectionView.destroy(): releases the document subscriptions (change hub,
 * before/afterTransaction, undo-manager listeners, text trackers); the view
 * becomes inert while sibling views on the same doc keep working.
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
  blocks: [blockId],
});

/** One paragraph "hello". */
const withParagraph = (doc: Doc): string => {
  const id = doc.insertBlock("paragraph");
  doc.insertText(id, 0, "hello");
  return id;
};

describe("SelectionView.destroy", () => {
  it("document changes no longer rebase a destroyed view", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const id = withParagraph(doc);
    const sel = createSelection(doc);
    sel.set(caret(id, 2));

    sel.destroy();
    doc.insertText(id, 0, "XX"); // a live view would shift the caret to 4

    expect(sel.get()).toEqual(caret(id, 2));
  });

  it("undo/redo no longer restore the selection on a destroyed view", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const id = withParagraph(doc);
    const sel = createSelection(doc);
    sel.set(caret(id, 5));
    doc.deleteText(id, 0, 2); // a live view rebases the caret 5 -> 3
    sel.destroy();

    doc.undo(); // the text is back; a live view would restore the caret to 5

    expect(doc.getText(id)).toBe("hello");
    expect(sel.get()).toEqual(caret(id, 3));
  });

  it("set() throws on a destroyed view while get() still returns the last state", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const id = withParagraph(doc);
    const sel = createSelection(doc);
    sel.set(caret(id, 2));
    sel.destroy();

    expect(() => sel.set(caret(id, 0))).toThrow(DestroyedViewError);
    expect(sel.get()).toEqual(caret(id, 2));
  });

  it("destroy is idempotent", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const id = withParagraph(doc);
    const sel = createSelection(doc);
    sel.set(caret(id, 1));
    sel.destroy();

    expect(() => sel.destroy()).not.toThrow();
    expect(sel.get()).toEqual(caret(id, 1));
  });

  it("a sibling view on the same doc keeps rebasing after one view is destroyed", () => {
    const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    const id = withParagraph(doc);
    const a = createSelection(doc);
    const b = createSelection(doc);
    a.set(caret(id, 1));
    b.set(caret(id, 4));
    let bCalls = 0;
    b.onChange(() => {
      bCalls += 1;
    });
    a.destroy();

    doc.insertText(id, 0, "X"); // shifts both live carets by one

    expect(a.get()).toEqual(caret(id, 1)); // frozen
    expect(b.get()).toEqual(caret(id, 5));
    expect(bCalls).toBeGreaterThan(0); // b still emits
  });
});
