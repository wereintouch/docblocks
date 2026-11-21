import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { flattenDoc, validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

const CREATED_AT = "2026-10-01T00:00:00Z";

/** The five remodeled types (the legacy `children` form). */
const REFORMED = ["paragraph", "heading", "list-item", "callout", "code"] as const;

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

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
      t: { type: "table", columnOrder: ["col0"], children: ["row"] },
      row: { type: "table-row", children: ["cell"] },
      cell: { type: "table-cell", attrs: { columnId: "col0" }, children: ["cp", "cq"] },
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
      t: { type: "table", columnOrder: ["col0"], children: ["row"] },
      row: { type: "table-row", children: ["cell"] },
      cell: { type: "table-cell", attrs: { columnId: "col0" }, children: ["cp", "cr", "cq"] },
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
