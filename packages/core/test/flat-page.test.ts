import { describe, expect, it } from "vitest";

import { DocBlocksError, InvalidAttrsError, InvalidOperationError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { BLOCK_REGISTRY, PAGE_BLOCK_TYPES, validateDoc } from "../src/schema";

/**
 * The flat page model: the page content
 * is ONE flat sequence; the nesting is the `indent` attr relative to the
 * preceding block of the same sequence. The 10-13 nested-text-container
 * feature is remodeled here (the same scenarios, expressed via indent).
 */

const CREATED_AT = "2026-10-01T00:00:00Z";

/** The five remodeled types (the legacy `children` form). */
const REFORMED = ["paragraph", "heading", "list-item", "callout", "code"] as const;

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

describe("the flat page model (registry)", () => {
  it("the remodeled types are structurally childless with the legacy child rules kept", () => {
    const pageSet = BLOCK_REGISTRY["root"].childrenTypes;
    for (const type of REFORMED) {
      expect(BLOCK_REGISTRY[type].children, `${type} is structurally childless`).toBe(false);
    }
    for (const type of ["paragraph", "heading", "callout", "code"] as const) {
      expect(BLOCK_REGISTRY[type].legacyChildrenTypes, `${type} keeps the page set`).toEqual(pageSet);
    }
    // The list marker model stands: a list item nests only under a list item.
    expect(BLOCK_REGISTRY["list-item"].legacyChildrenTypes).toEqual(["list-item"]);
    // The structural containers keep `children` (the writer contract).
    for (const type of ["root", "table", "table-row", "table-cell", "surface"] as const) {
      expect(BLOCK_REGISTRY[type].children, `${type} keeps children`).toBe(true);
    }
    // The frame is a viewport window (no children — the legacy nested page
    // is gone; the read drops the link, the strict validator flags it).
    expect(BLOCK_REGISTRY["frame"].children).toBe(false);
  });

  it("the indent attr is registered exactly on the page-sequence types", () => {
    for (const type of PAGE_BLOCK_TYPES) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `indent on ${type}`).toBeDefined();
    }
    for (const type of ["table-row", "table-cell", "shape", "connector", "canvas-text", "root"] as const) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `no indent on ${type}`).toBeUndefined();
    }
  });
});

describe("the flat page model (commands)", () => {
  it("insertBlock and moveBlock reject a page-content block as the parent (flat sequence only)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "container");
    const li = doc.insertBlock("list-item", { list: "bullet" });
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });

    expectThrows(() => doc.insertBlock("paragraph", undefined, { parent: p }), InvalidOperationError);
    expectThrows(() => doc.insertBlock("list-item", { list: "bullet" }, { parent: li }), InvalidOperationError);
    expectThrows(() => doc.moveBlock(row, p, 0), InvalidOperationError);
    // The doc stands (no partial mutation).
    expect(doc.getChildren(p)).toEqual([]);
    expect(doc.getChildren(li)).toEqual([]);
    expect(doc.getChildren(table)).toEqual([row]);
  });

  it("the flat nesting (indent) round-trips and validates", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "container");
    const child = doc.insertBlock("paragraph");
    doc.insertText(child, 0, "nested paragraph");
    doc.updateBlock(child, { indent: 1 });
    const li = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(li, 0, "nested list");
    doc.updateBlock(li, { indent: 1 });

    const json = doc.toJSON();
    expect(validateDoc(json)).toEqual([]);
    const asChild = json.blocks[child]!;
    expect(asChild.type).toBe("paragraph");
    expect("children" in asChild).toBe(false);
    expect((asChild as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(doc.getText(p)).toBe("container");
    expect(doc.getText(child)).toBe("nested paragraph");
    expect(doc.getText(li)).toBe("nested list");

    // The fromJSON -> toJSON round trip is exact (the flat form is byte-stable).
    const restored = fromJSON(json);
    expect(restored.toJSON()).toEqual(json);
    expect(JSON.stringify(restored.toJSON())).toBe(JSON.stringify(json));
  });

  it("the structural containers keep their moves (cell content within the cell sequence)", () => {
    const doc = newDoc();
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const cell = doc.insertBlock("table-cell", undefined, { parent: row });
    const inner = doc.insertBlock("paragraph", undefined, { parent: cell });
    doc.insertText(inner, 0, "in cell");
    const second = doc.insertBlock("paragraph", undefined, { parent: cell });
    doc.moveBlock(inner, cell, 2); // within the cell sequence (toIndex is a pre-move index)
    expect(doc.getChildren(cell)).toEqual([second, inner]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("changeBlockType across the remodeled types keeps content and the indent", () => {
    const doc = newDoc();
    const first = doc.insertBlock("paragraph");
    doc.insertText(first, 0, "first");
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "code-ish");
    doc.updateBlock(p, { indent: 1 });

    doc.changeBlockType(p, "code", { language: "ts" });
    expect(doc.getBlock(p)?.type).toBe("code");
    expect((doc.getBlock(p) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1); // the target also declares it
    expect(doc.getText(p)).toBe("code-ish");
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("updateBlock keeps the indent-jump rule (the live doc stays valid)", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 }); // the boundary (prev + 1) is accepted

    // A jump (prev + 2) is rejected with a typed error.
    const err = expectThrows(() => doc.updateBlock(b, { indent: 2 }), InvalidAttrsError);
    expect(err.message).toContain("by more than 1");
    // The first block of a sequence anchors at indent 0.
    expectThrows(() => doc.updateBlock(a, { indent: 1 }), InvalidAttrsError);
    // The doc stands (no partial mutation).
    expect((doc.getBlock(b) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });

  it("updateBlock rejects an outdent that would dangle the next block (the TO side)", () => {
    const doc = newDoc();
    doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 });
    const c = doc.insertBlock("paragraph");
    doc.updateBlock(c, { indent: 2 });
    // [a(0), b(1), c(2)]: b outdenting to 0 would dangle c (2 > 0 + 1) —
    // the stranded pair breaks, rejected.
    const err = expectThrows(() => doc.updateBlock(b, { indent: 0 }), InvalidOperationError);
    expect(err.message).toContain("stranded");
    // The doc stands (no partial mutation).
    expect((doc.getBlock(b) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
    expect(validateDoc(doc.toJSON())).toEqual([]);

    // An outdent with no deeper follower is accepted: [a(0), b(1)] —
    // b to 0, nothing to dangle.
    const shallow = newDoc();
    shallow.insertBlock("paragraph");
    const bS = shallow.insertBlock("paragraph");
    shallow.updateBlock(bS, { indent: 1 });
    expect(() => shallow.updateBlock(bS, { indent: 0 })).not.toThrow();
    expect(validateDoc(shallow.toJSON())).toEqual([]);
    expect((shallow.getBlock(bS) as { attrs?: { indent?: number } }).attrs?.indent).toBe(0);

    // The UI's segment outdent: the whole stretch composes in one transact
    // (the mid-transact dangle is a transient the composition resolves).
    const d = newDoc();
    d.insertBlock("paragraph");
    const b2 = d.insertBlock("paragraph");
    d.updateBlock(b2, { indent: 1 });
    const c2 = d.insertBlock("paragraph");
    d.updateBlock(c2, { indent: 2 });
    d.transact(() => {
      d.updateBlock(b2, { indent: 0 });
      d.updateBlock(c2, { indent: 1 });
    });
    expect(validateDoc(d.toJSON())).toEqual([]);
    expect((d.getBlock(b2) as { attrs?: { indent?: number } }).attrs?.indent).toBe(0);
    expect((d.getBlock(c2) as { attrs?: { indent?: number } }).attrs?.indent).toBe(1);
  });

  it("insertBlock keeps the indent-jump rule at the landing position", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    expect(doc.insertBlock("paragraph", { indent: 1 })).toBeDefined(); // prev + 1
    expectThrows(() => doc.insertBlock("paragraph", { indent: 2 }, { after: a }), InvalidAttrsError);
    // The first block of an empty sequence anchors at indent 0.
    const empty = newDoc();
    expectThrows(() => empty.insertBlock("paragraph", { indent: 1 }), InvalidAttrsError);
  });

  it("insertBlock rejects an insert that would dangle the displaced block (the TO side)", () => {
    const doc = newDoc();
    const a = doc.insertBlock("paragraph");
    const b = doc.insertBlock("paragraph");
    doc.updateBlock(b, { indent: 1 });
    const c = doc.insertBlock("paragraph");
    doc.updateBlock(c, { indent: 2 });
    // [a(0), b(1), c(2)]: a same-indent insert after a displaces b (1 <=
    // 0 + 1) — accepted.
    expect(doc.insertBlock("paragraph", { indent: 0 }, { after: a })).toBeDefined();
    // [a(0), n(0), b(1), c(2)]: an indent-0 insert after b displaces c (2
    // > 0 + 1) — the displaced pair breaks, rejected.
    expectThrows(() => doc.insertBlock("paragraph", { indent: 0 }, { after: b }), InvalidAttrsError);
    // The doc stands (no partial mutation).
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });
});
