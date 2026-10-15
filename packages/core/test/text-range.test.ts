import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidOperationError, InvalidRangeError, UnknownBlockError, createDoc } from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A doc with the paragraph "hello" (b0), a divider (b1), the paragraph "world" (b2). */
const withRangeDoc = (): { doc: Doc; a: string; divider: string; c: string } => {
  const doc = createDoc({ id: "d", createdAt: CREATED_AT, generateId: makeIds("b") });
  const a = doc.insertBlock("paragraph");
  doc.insertText(a, 0, "hello");
  const divider = doc.insertBlock("divider");
  const c = doc.insertBlock("paragraph");
  doc.insertText(c, 0, "world");
  return { doc, a, divider, c };
};

const blockCount = (doc: Doc): number => Object.keys(doc.toJSON().blocks).length;

const countUpdates = (doc: Doc): (() => number) => {
  let updates = 0;
  doc.raw.on("update", () => updates++);
  return () => updates;
};

/** Delta of the sender's state that the receiver is still missing. */
const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));

/** Full bidirectional exchange (A→B then B→A). */
const exchange = (a: Doc, b: Doc): void => {
  b.applyUpdate(deltaOf(a, b));
  a.applyUpdate(deltaOf(b, a));
};

describe("deleteTextRange — same-block delegation", () => {
  it("trims the block like deleteText; the seam is the range start", () => {
    const { doc, a } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 1 }, { blockId: a, offset: 4 });
    expect(doc.getText(a)).toBe("ho");
    expect(result).toEqual({ blockId: a, offset: 1 });
    expect(blockCount(doc)).toBe(4); // the block is kept (the per-block posture)
  });

  it("a zero range is a no-op and returns the point", () => {
    const { doc, a } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 2 }, { blockId: a, offset: 2 });
    expect(doc.getText(a)).toBe("hello");
    expect(result).toEqual({ blockId: a, offset: 2 });
  });
});

describe("deleteTextRange — cross", () => {
  it("trims the endpoints, removes the middle (text and non-text), and seams at the from block", () => {
    const { doc, a, divider, c } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 1 }, { blockId: c, offset: 2 });
    expect(doc.getText(a)).toBe("h");
    expect(doc.getText(c)).toBe("rld");
    expect(doc.getBlock(divider)).toBeNull();
    expect(result).toEqual({ blockId: a, offset: 1 });
  });

  it("removes the endpoint blocks the trim emptied; the seam is the to block's start", () => {
    const { doc, a, c } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 0 }, { blockId: c, offset: 2 });
    expect(doc.getBlock(a)).toBeNull();
    expect(doc.getText(c)).toBe("rld");
    expect(result).toEqual({ blockId: c, offset: 0 });
  });

  it("returns null when the document carries no text left", () => {
    const { doc, a, c } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 0 }, { blockId: c, offset: 5 });
    expect(doc.getBlock(a)).toBeNull();
    expect(doc.getBlock(c)).toBeNull();
    expect(blockCount(doc)).toBe(1); // only the root
    expect(result).toBeNull();
  });

  it("a range that starts at the from block's end seams at the range start (the same seam as the to block's start)", () => {
    const { doc, a, c } = withRangeDoc();
    const result = doc.deleteTextRange({ blockId: a, offset: 5 }, { blockId: c, offset: 2 });
    expect(doc.getText(a)).toBe("hello"); // nothing trimmed there
    expect(doc.getText(c)).toBe("rld");
    expect(result).toEqual({ blockId: a, offset: 5 });
  });

  it("seams at the first block with text after the interval when both endpoints were consumed", () => {
    const { doc, a, c } = withRangeDoc();
    const d = doc.insertBlock("paragraph");
    doc.insertText(d, 0, "tail");
    const result = doc.deleteTextRange({ blockId: a, offset: 0 }, { blockId: c, offset: 5 });
    expect(result).toEqual({ blockId: d, offset: 0 });
    expect(doc.getText(d)).toBe("tail");
  });

  it("removes the middle segment with it (the flat subtree: the deeper-indented blocks too)", () => {
    const { doc, a, c } = withRangeDoc();
    const list = doc.insertBlock("list-item", { list: "bullet" }, { after: a });
    doc.insertText(list, 0, "one");
    const deeper = doc.insertBlock("list-item", { list: "bullet" }, { after: list });
    doc.insertText(deeper, 0, "two");
    doc.updateBlock(deeper, { indent: 1 }); // the flat "child" of the list item
    // Order: paragraph, list item, its deeper segment, divider, paragraph.
    expect(doc.getChildren("d")).toEqual([a, list, deeper, "b1", c]);
    const result = doc.deleteTextRange({ blockId: a, offset: 1 }, { blockId: c, offset: 1 });
    expect(doc.getBlock(list)).toBeNull();
    expect(doc.getBlock(deeper)).toBeNull();
    expect(doc.getText(a)).toBe("h");
    expect(doc.getText(c)).toBe("orld");
    expect(result).toEqual({ blockId: a, offset: 1 });
  });

  it("removes the emptied from block's flat segment with it", () => {
    const doc = createDoc({ id: "d", createdAt: CREATED_AT, generateId: makeIds("b") });
    const a = doc.insertBlock("paragraph");
    doc.insertText(a, 0, "hello");
    const nested = doc.insertBlock("paragraph");
    doc.insertText(nested, 0, "nested");
    doc.updateBlock(nested, { indent: 1 }); // the flat "child" of a
    const c = doc.insertBlock("paragraph");
    doc.insertText(c, 0, "world");
    const result = doc.deleteTextRange({ blockId: a, offset: 0 }, { blockId: c, offset: 2 });
    expect(doc.getBlock(a)).toBeNull();
    expect(doc.getBlock(nested)).toBeNull();
    expect(doc.getText(c)).toBe("rld");
    expect(result).toEqual({ blockId: c, offset: 0 });
  });
});

describe("deleteTextRange — batching", () => {
  it("is one wire update and one undo step", () => {
    const { doc, a, c } = withRangeDoc();
    const before = doc.toJSON();
    const updates = countUpdates(doc);

    doc.deleteTextRange({ blockId: a, offset: 1 }, { blockId: c, offset: 2 });
    expect(updates()).toBe(1);

    doc.undo();
    expect(doc.toJSON()).toEqual(before);
    expect(updates()).toBe(2);
  });
});

describe("deleteTextRange — typed errors", () => {
  it("to before from, unknown block, non-text endpoint, and out-of-range offset", () => {
    const { doc, a, divider, c } = withRangeDoc();
    expect(() => doc.deleteTextRange({ blockId: c, offset: 0 }, { blockId: a, offset: 1 })).toThrow(InvalidRangeError);
    expect(() => doc.deleteTextRange({ blockId: "nope", offset: 0 }, { blockId: c, offset: 1 })).toThrow(
      UnknownBlockError
    );
    expect(() => doc.deleteTextRange({ blockId: divider, offset: 0 }, { blockId: c, offset: 1 })).toThrow(
      InvalidOperationError
    );
    expect(() => doc.deleteTextRange({ blockId: a, offset: 99 }, { blockId: c, offset: 1 })).toThrow(InvalidRangeError);
    expect(() => doc.deleteTextRange({ blockId: a, offset: 0 }, { blockId: c, offset: 99 })).toThrow(InvalidRangeError);
    // The errors are thrown before the mutation: the doc stands.
    expect(doc.getText(a)).toBe("hello");
    expect(doc.getText(c)).toBe("world");
  });
});

describe("setMarkRange", () => {
  it("marks the per-block segments: endpoint partial, middle full", () => {
    const { doc, a, divider, c } = withRangeDoc();
    const mid = doc.insertBlock("paragraph", undefined, { parent: "d", after: a });
    doc.insertText(mid, 0, "mid");

    doc.setMarkRange({ blockId: a, offset: 1 }, { blockId: c, offset: 2 }, { type: "bold" });

    expect(doc.getRuns(a)).toEqual([
      { text: "h", marks: {} },
      { text: "ello", marks: { bold: true } },
    ]);
    expect(doc.getRuns(mid)).toEqual([{ text: "mid", marks: { bold: true } }]);
    expect(doc.getRuns(c)).toEqual([
      { text: "wo", marks: { bold: true } },
      { text: "rld", marks: {} },
    ]);
    expect(doc.getBlock(divider)).toEqual({ type: "divider" }); // the non-text middle is skipped
  });

  it("delegates a same-block range to setMark", () => {
    const { doc, a } = withRangeDoc();
    doc.setMarkRange({ blockId: a, offset: 1 }, { blockId: a, offset: 4 }, { type: "italic" });
    expect(doc.getRuns(a)).toEqual([
      { text: "h", marks: {} },
      { text: "ell", marks: { italic: true } },
      { text: "o", marks: {} },
    ]);
  });

  it("rejects the whole range when a covered text block is a code block (the per-block posture)", () => {
    const { doc, a, c } = withRangeDoc();
    const code = doc.insertBlock("code");
    doc.insertText(code, 0, "let x = 1");
    doc.moveBlock(code, "d", 1);

    expect(() => doc.setMarkRange({ blockId: a, offset: 0 }, { blockId: c, offset: 1 }, { type: "bold" })).toThrow(
      InvalidOperationError
    );
    // A code endpoint is rejected too.
    expect(() => doc.setMarkRange({ blockId: code, offset: 0 }, { blockId: c, offset: 1 }, { type: "bold" })).toThrow(
      InvalidOperationError
    );
    // The rejection is before the transaction: no partial marks.
    expect(doc.getRuns(a)).toEqual([{ text: "hello", marks: {} }]);
    expect(doc.getRuns(c)).toEqual([{ text: "world", marks: {} }]);
  });

  it("is one undo step", () => {
    const { doc, a, c } = withRangeDoc();
    const before = doc.toJSON();
    doc.setMarkRange({ blockId: a, offset: 1 }, { blockId: c, offset: 2 }, { type: "bold" });
    doc.undo();
    expect(doc.toJSON()).toEqual(before);
  });

  it("is one wire update", () => {
    const { doc, a, c } = withRangeDoc();
    const updates = countUpdates(doc);
    doc.setMarkRange({ blockId: a, offset: 1 }, { blockId: c, offset: 2 }, { type: "bold" });
    expect(updates()).toBe(1);
  });
});

describe("convergence (the house property)", () => {
  const seed = (d: Doc): void => {
    const p1 = d.insertBlock("paragraph");
    d.insertText(p1, 0, "hello");
    d.insertBlock("divider");
    const p2 = d.insertBlock("paragraph");
    d.insertText(p2, 0, "world");
  };

  // The peer's base comes from the first joiner's full state (the attach
  // bootstrap), not a twin seed: two independent seeds author the same
  // items twice, and the independent-skeleton merge is not convergence
  // (the shared-skeleton gotcha).
  const peerOf = (base: Doc): Doc => {
    const peer = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    peer.applyUpdate(base.encode());
    return peer;
  };

  it("a cross deleteTextRange converges with a peer editing a block inside the range", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    seed(a);
    const b = peerOf(a);

    a.deleteTextRange({ blockId: "b0", offset: 0 }, { blockId: "b2", offset: 2 });
    b.insertText("b2", 5, "!"); // the peer appends at the to endpoint

    exchange(a, b);
    expect(a.toJSON()).toEqual(b.toJSON());
    expect(a.toJSON().blocks.b1).toBeUndefined(); // the divider is gone on both sides
  });

  it("a cross deleteTextRange converges with a peer appending at the from endpoint", () => {
    const a = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
    seed(a);
    const b = peerOf(a);

    a.deleteTextRange({ blockId: "b0", offset: 1 }, { blockId: "b2", offset: 5 });
    b.insertText("b0", 5, "!!");

    exchange(a, b);
    expect(a.toJSON()).toEqual(b.toJSON());
  });
});
