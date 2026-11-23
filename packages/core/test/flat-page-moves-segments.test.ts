import { describe, expect, it } from "vitest";

import { DocBlocksError, InvalidAttrsError, InvalidOperationError, createDoc, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-10-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

const expectThrows = (fn: () => unknown, ctor: new (message: string) => Error): Error => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    expect(error).toBeInstanceOf(DocBlocksError);
    return error as Error;
  }
  throw new Error("expected the command to throw");
};

describe("the flat page model (commands)", () => {
  it("moveBlock rejects a landing that would dangle the displaced block (the TO side)", () => {
    const doc = newDoc();
    const root = doc.meta.id;
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 });
    const c = doc.insertBlock("paragraph");
    doc.updateBlock(c, { indent: 2 });
    const t = doc.insertBlock("paragraph");
    doc.updateBlock(t, { indent: 3 });
    const l = doc.insertBlock("paragraph");
    doc.updateBlock(l, { indent: 1 });
    // [a(0), b(1), c(2), t(3), l(1)]: l landing after c passes its own
    // check (1 <= 2 + 1), but t would then stand after l (3 > 1 + 1) —
    // the displaced pair breaks, rejected.
    expectThrows(() => doc.moveBlock(l, root, 3), InvalidOperationError);
    // The doc stands.
    expect(doc.getChildren(root)).toEqual([a, b, c, t, l]);
    // A landing that keeps the displaced pair is accepted (the end has no
    // displaced block).
    doc.moveBlock(l, root, 1); // after a: t is not displaced, l's pair (0, 1) holds
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("moveBlock keeps the indent-jump rule at the landed position", () => {
    const doc = newDoc();
    const root = doc.meta.id;
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    const c = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 });
    doc.updateBlock(c, { indent: 2 });

    // c (indent 2) cannot land after a (indent 0) — the jump would be 2.
    expectThrows(() => doc.moveBlock(c, root, 1), InvalidOperationError);
    // b (indent 1) cannot land at the head of the sequence.
    expectThrows(() => doc.moveBlock(b, root, 0), InvalidOperationError);
    // The doc stands.
    expect(doc.getChildren(root)).toEqual([a, b, c]);
    // A landed position that keeps the rule is accepted.
    doc.moveBlock(c, root, 2); // after b (indent 1): 2 <= 1 + 1
    expect(validateDoc(doc.toJSON())).toEqual([]);
    expect(loadDoc(doc.encode()).toJSON()).toEqual(doc.toJSON()); // the round trip validates
  });

  it("structural contexts keep their moves (the jump rule is page-sequence only)", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 2 });
    const r1 = doc.insertBlock("table-row", undefined, { parent: table });
    doc.insertBlock("table-cell", undefined, { parent: r1 });
    doc.insertBlock("table-cell", undefined, { parent: r1 });
    const r2 = doc.insertBlock("table-row", undefined, { parent: table });
    doc.insertBlock("table-cell", undefined, { parent: r2 });
    doc.insertBlock("table-cell", undefined, { parent: r2 });
    doc.moveBlock(r2, table, 0); // a row move: no jump check (structural order)
    expect(doc.getChildren(table)).toEqual([r2, r1]);
  });

  it("changeBlockType keeps the indent-jump rule for the post-change attrs", () => {
    const doc = newDoc();
    doc.insertBlock("paragraph");
    doc.insertBlock("paragraph");
    const c = doc.insertBlock("paragraph");
    doc.updateBlock(c, { indent: 1 });

    // A patch carrying a jumping indent is rejected (the position stands).
    expectThrows(() => doc.changeBlockType(c, "heading", { level: 1, indent: 2 }), InvalidAttrsError);
    expect((doc.getBlock(c) as { type: string }).type).toBe("paragraph");
    // The boundary (prev + 1) is accepted.
    doc.changeBlockType(c, "heading", { level: 1, indent: 1 });
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("removeBlock cascades the derived segment (the live doc stays valid)", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    const c = doc.insertBlock("paragraph");
    const d = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 });
    doc.updateBlock(c, { indent: 2 });

    // Removing the segment head removes the whole segment (b and c), the
    // shallower follower d stands — the doc stays valid.
    doc.removeBlock(b);
    expect(doc.getChildren(doc.meta.id)).toEqual([a, d]);
    expect(doc.getBlock(b)).toBeNull();
    expect(doc.getBlock(c)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // A block without deeper followers removes alone.
    const e = doc.insertBlock("paragraph");
    doc.updateBlock(e, { indent: 1 });
    doc.removeBlock(e);
    expect(doc.getChildren(doc.meta.id)).toEqual([a, d]);
  });

  it("removeBlock removes a structural container's descendants inside the segment", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const h = doc.insertBlock("heading", { level: 2 });
    const table = doc.insertBlock("table", { cols: 1 });
    doc.updateBlock(h, { indent: 1 });
    doc.updateBlock(table, { indent: 2 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    doc.insertBlock("table-cell", undefined, { parent: row });
    const d = doc.insertBlock("paragraph");

    // The heading's segment holds the table (indent 2): removing the
    // heading removes the table WITH its row and cell — no orphans.
    doc.removeBlock(h);
    expect(doc.getChildren(doc.meta.id)).toEqual([a, d]);
    expect(doc.getBlock(table)).toBeNull();
    expect(doc.getBlock(row)).toBeNull();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("moveBlock rejects a single-block move that would strand the block's derived segment", () => {
    const doc = newDoc();
    const root = doc.meta.id;
    const x = doc.insertBlock("paragraph");
    const a = doc.insertBlock("paragraph", { indent: 1 });
    const b = doc.insertBlock("paragraph", { indent: 2 });
    const c = doc.insertBlock("paragraph");

    // Moving a (the segment head) past the shallower boundary c would
    // leave b at a's old slot — b(2) after x(0) is a jump. The command
    // moves one block, so the move is rejected (the segment must be
    // moved with the block — the UI composes segment moves).
    const err = expectThrows(() => doc.moveBlock(a, root, 3), InvalidOperationError);
    expect(err.message).toContain("derived segment");
    // The doc stands (no partial mutation).
    expect(doc.getChildren(root)).toEqual([x, a, b, c]);
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // A move that strands no follower is unaffected: b has no deeper
    // follower (c's indent 0 stops its segment) and the landing keeps
    // the rule — the single-block move stands.
    const d = doc.insertBlock("paragraph", { indent: 1 });
    doc.moveBlock(b, root, 5); // to the end, after d(1): 2 <= 1 + 1
    expect(doc.getChildren(root)).toEqual([x, a, c, d, b]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});
