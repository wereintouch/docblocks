import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DocBlocksError, InvalidAttrsError, InvalidOperationError, createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { BLOCK_REGISTRY, PAGE_BLOCK_TYPES, flattenDoc, validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

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
    for (const type of ["root", "table", "table-row", "table-cell", "surface", "frame"] as const) {
      expect(BLOCK_REGISTRY[type].children, `${type} keeps children`).toBe(true);
    }
  });

  it("the indent attr is registered exactly on the page-sequence types", () => {
    for (const type of PAGE_BLOCK_TYPES) {
      expect(BLOCK_REGISTRY[type].attrs?.indent, `indent on ${type}`).toBeDefined();
    }
    for (const type of ["table-row", "table-cell", "shape", "connector", "frame", "canvas-text", "root"] as const) {
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
    const row = doc.insertBlock("table-row", undefined, { parent: table });
    const c1 = doc.insertBlock("table-cell", undefined, { parent: row });
    const c2 = doc.insertBlock("table-cell", undefined, { parent: row });
    doc.moveBlock(c2, row, 0); // a cell move: no jump check (structural order)
    expect(doc.getChildren(row)).toEqual([c2, c1]);
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

describe("the legacy shape (eager normalization at load)", () => {
  /**
   * The legacy (nested) shape of a small mixed doc: a text container
   * with a nested paragraph, a nested list item, and a table cell whose
   * mini-doc holds a nested paragraph.
   */
  const legacy: DocJSON = {
    v: 1,
    id: "r",
    title: "T",
    createdAt: CREATED_AT,
    blocks: {
      r: { type: "root", children: ["p", "li", "t"] },
      p: { type: "paragraph", content: [{ text: "c", marks: {} }], children: ["q"] },
      q: { type: "paragraph", content: [{ text: "n", marks: {} }] },
      li: { type: "list-item", attrs: { list: "bullet" }, children: ["li2"] },
      li2: { type: "list-item", attrs: { list: "bullet", indent: 0 } },
      t: { type: "table", attrs: { cols: 1 }, children: ["row"] },
      row: { type: "table-row", children: ["cell"] },
      cell: { type: "table-cell", children: ["cp", "cq"] },
      cp: { type: "paragraph", content: [{ text: "cell p", marks: {} }], children: ["cr"] },
      cr: { type: "paragraph", content: [{ text: "cell n", marks: {} }] },
      cq: { type: "callout", content: [{ text: "cell q", marks: {} }] },
    },
  };

  /** The same content in the flat (writer) shape — what flattenDoc(legacy) must equal byte-for-byte. */
  const flat: DocJSON = {
    v: 1,
    id: "r",
    title: "T",
    createdAt: CREATED_AT,
    blocks: {
      r: { type: "root", children: ["p", "q", "li", "li2", "t"] },
      p: { type: "paragraph", content: [{ text: "c", marks: {} }] },
      q: { type: "paragraph", content: [{ text: "n", marks: {} }], attrs: { indent: 1 } },
      li: { type: "list-item", attrs: { list: "bullet" } },
      li2: { type: "list-item", attrs: { list: "bullet", indent: 1 } },
      t: { type: "table", attrs: { cols: 1 }, children: ["row"] },
      row: { type: "table-row", children: ["cell"] },
      cell: { type: "table-cell", children: ["cp", "cr", "cq"] },
      cp: { type: "paragraph", content: [{ text: "cell p", marks: {} }] },
      cr: { type: "paragraph", content: [{ text: "cell n", marks: {} }], attrs: { indent: 1 } },
      cq: { type: "callout", content: [{ text: "cell q", marks: {} }] },
    },
  };

  it("both shapes are valid v1 (validator duality)", () => {
    expect(validateDoc(legacy)).toEqual([]);
    expect(validateDoc(flat)).toEqual([]);
  });

  it("flattenDoc maps the old shape to the flat shape byte-for-byte (and is idempotent on it)", () => {
    expect(JSON.stringify(flattenDoc(legacy))).toBe(JSON.stringify(flat));
    expect(JSON.stringify(flattenDoc(flat))).toBe(JSON.stringify(flat));
    // The input is not mutated.
    expect(JSON.stringify(legacy)).toContain('"children":["q"]');
  });

  it("fromJSON of the old shape loads a flat doc equal to the flat-shape doc", () => {
    const fromLegacy = fromJSON(legacy).toJSON();
    const fromFlat = fromJSON(flat).toJSON();
    expect(JSON.stringify(fromLegacy)).toBe(JSON.stringify(fromFlat));
    // The writer contract: no legacy children on the remodeled types.
    for (const type of REFORMED) {
      for (const block of Object.values(fromLegacy.blocks)) {
        if (block.type === type) expect("children" in block).toBe(false);
      }
    }
  });

  it("loadDoc of the old-shape snapshot loads a flat doc; the flat snapshot loads as-is", () => {
    const a = fromJSON(legacy);
    const restored = loadDoc(a.encode());
    expect(JSON.stringify(restored.toJSON())).toBe(JSON.stringify(fromJSON(flat).toJSON()));
    // The flat snapshot loads as-is (no rewrite): the state is byte-identical.
    const flatDoc = fromJSON(flat);
    expect(JSON.stringify(loadDoc(flatDoc.encode()).toJSON())).toBe(JSON.stringify(flatDoc.toJSON()));
  });

  it("convergence: the legacy-shape peer is the room's base; a peer bootstrapped from it converges to the same flat state", () => {
    // Two peers of one document cannot build its layout independently (the
    // shared-skeleton rule); the supported init is the bootstrap: the first
    // joiner's full state is the room's base (attach sends it). So: one
    // peer loads the legacy snapshot, the other takes it via the bootstrap.
    const base = fromJSON(legacy);
    const joiner = loadDoc(base.encode());
    // The joiner lands on the base's normalized (flat) state, byte for byte
    // (the bootstrap delivers the base's full state as-is).
    expect(JSON.stringify(joiner.toJSON())).toBe(JSON.stringify(base.toJSON()));
    expect(validateDoc(joiner.toJSON())).toEqual([]);

    // Divergent edits after the bootstrap (different blocks of the shared
    // normalized content, addressed by the shared block ids).
    base.insertText("q", 0, "A-"); // the inlined (formerly nested) block
    joiner.insertText("cr", 0, "B-"); // the inlined cell block

    const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));
    joiner.applyUpdate(deltaOf(base, joiner));
    base.applyUpdate(deltaOf(joiner, base));

    expect(base.toJSON()).toEqual(joiner.toJSON());
    // Both edits landed on both sides, and the state is flat + valid.
    const final = base.toJSON();
    expect(validateDoc(final)).toEqual([]);
    const textOf = (id: string): string => {
      const block = final.blocks[id]!;
      return "content" in block ? (block.content ?? []).reduce((t, run) => t + run.text, "") : "";
    };
    expect(textOf("q")).toBe("A-n");
    expect(textOf("cr")).toBe("B-cell n");
  });
});

describe("the additive posture (no legacy children -> no children field)", () => {
  it("a fresh doc without nested text blocks exports no children on the remodeled types", () => {
    const doc = newDoc();
    doc.transact(() => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "p");
      const h = doc.insertBlock("heading", { level: 2 });
      doc.insertText(h, 0, "h");
      const c = doc.insertBlock("code", { language: "ts" });
      doc.insertText(c, 0, "c");
      const co = doc.insertBlock("callout", { variant: "info" });
      doc.insertText(co, 0, "co");
    });

    const json = doc.toJSON();
    expect(validateDoc(json)).toEqual([]);
    for (const [id, block] of Object.entries(json.blocks)) {
      if (id === doc.meta.id) continue;
      expect("children" in block, `block ${id} (${block.type}) omits empty children`).toBe(false);
    }
    // The root keeps its children (always emitted).
    expect((json.blocks[doc.meta.id] as { type: "root"; children: string[] }).children).toBeDefined();
  });
});
