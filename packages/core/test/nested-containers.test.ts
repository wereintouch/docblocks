import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { DocBlocksError, InvalidChildError, InvalidOperationError, createDoc, fromJSON, loadDoc } from "../src/core";
import type { Doc } from "../src/core";
import { BLOCK_REGISTRY, validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

/** The five text types that hold the full page set as children. */
const TEXT_CONTAINERS = ["paragraph", "heading", "callout", "code", "latex"] as const;

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

describe("the text containers (registry)", () => {
  it("the five text types hold the full page set (the root's set)", () => {
    const pageSet = BLOCK_REGISTRY["root"].childrenTypes;
    expect(pageSet).toBeDefined();
    for (const type of TEXT_CONTAINERS) {
      const spec = BLOCK_REGISTRY[type];
      expect(spec.children, `${type} is a container`).toBe(true);
      expect(spec.childrenTypes, `${type} holds the page set`).toEqual(pageSet);
    }
    // The list marker model stands: a list item nests only under a list item.
    expect(BLOCK_REGISTRY["list-item"].childrenTypes).toEqual(["list-item"]);
  });

  it("a non-container type keeps children: false (image, divider)", () => {
    expect(BLOCK_REGISTRY["image"].children).toBe(false);
    expect(BLOCK_REGISTRY["divider"].children).toBe(false);
  });
});

describe("the text containers (commands)", () => {
  it("insertBlock and moveBlock reject a child type outside the page set", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "container");
    const table = doc.insertBlock("table", { cols: 1 });
    const row = doc.insertBlock("table-row", undefined, { parent: table });

    expectThrows(() => doc.insertBlock("table-row", undefined, { parent: p }), InvalidChildError);
    expectThrows(() => doc.moveBlock(row, p, 0), InvalidChildError);
    // The root is not a page block and cannot be moved at all.
    expectThrows(() => doc.moveBlock(doc.meta.id, p, 0), InvalidOperationError);
    // The doc stands (no partial mutation).
    expect(doc.getChildren(p)).toEqual([]);
    expect(doc.getChildren(table)).toEqual([row]);
  });

  it("a page block nests under a text container (embed under a paragraph)", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    const embed = doc.insertBlock("embed", { kind: "iframe", src: "https://example.com" }, { parent: p });

    expect(doc.getChildren(p)).toEqual([embed]);
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("a paragraph with a nested paragraph and a nested list round-trips", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "container");
    const child = doc.insertBlock("paragraph", undefined, { parent: p });
    doc.insertText(child, 0, "nested paragraph");
    const li = doc.insertBlock("list-item", { list: "bullet" }, { parent: p });
    doc.insertText(li, 0, "nested list");

    const json = doc.toJSON();
    expect(validateDoc(json)).toEqual([]);
    const container = json.blocks[p]!;
    expect(container.type).toBe("paragraph");
    expect("children" in container ? container.children : null).toEqual([child, li]);
    expect(doc.getText(p)).toBe("container");
    expect(doc.getText(child)).toBe("nested paragraph");
    expect(doc.getText(li)).toBe("nested list");

    // Structural plainness: the snapshot is JSON-round-trippable.
    expect(JSON.parse(JSON.stringify(json))).toEqual(json);

    // The fromJSON → toJSON round trip is exact.
    const restored = fromJSON(json).toJSON();
    expect(restored).toEqual(json);
  });

  it("the strict validator: children of a text block validate; a dangling id and a disallowed type fail", () => {
    const valid = {
      v: 1 as const,
      id: "r",
      title: "",
      createdAt: CREATED_AT,
      blocks: {
        r: { type: "root", children: ["p"] },
        p: { type: "paragraph", content: [{ text: "c", marks: {} }], children: ["q", "li"] },
        q: { type: "paragraph", content: [{ text: "n", marks: {} }] },
        li: { type: "list-item", attrs: { list: "bullet" }, content: [{ text: "l", marks: {} }] },
      },
    };
    expect(validateDoc(valid)).toEqual([]);

    const dangling = {
      ...valid,
      blocks: { ...valid.blocks, p: { type: "paragraph", children: ["nope"] } },
    };
    const danglingErrors = validateDoc(dangling);
    expect(danglingErrors.length).toBeGreaterThan(0);
    expect(danglingErrors.some((e) => e.message.includes('Dangling child id "nope"'))).toBe(true);

    const disallowed = {
      ...valid,
      blocks: {
        ...valid.blocks,
        p: { type: "paragraph", content: [{ text: "c", marks: {} }], children: ["li"] },
        li: { type: "table-row", children: [] },
      },
    };
    const disallowedErrors = validateDoc(disallowed);
    expect(disallowedErrors.some((e) => e.message.includes('is not allowed as a child of "paragraph"'))).toBe(true);
  });

  it("convergence: one peer indents (moveBlock) while the other edits both texts", () => {
    const base = newDoc();
    let p1 = "";
    let p2 = "";
    base.transact(() => {
      p1 = base.insertBlock("paragraph");
      base.insertText(p1, 0, "first");
      p2 = base.insertBlock("paragraph");
      base.insertText(p2, 0, "second");
    });

    // Twin copies of the same document: the same block ids on both sides,
    // so the move and the edits conflict on the same structure.
    const snapshot = base.encode();
    const x = loadDoc(snapshot);
    const y = loadDoc(snapshot);
    const deltaOf = (sender: Doc, receiver: Doc): Uint8Array => sender.encodeUpdate(Y.encodeStateVector(receiver.raw));
    const exchange = (side: Doc, other: Doc): void => {
      other.applyUpdate(deltaOf(side, other));
      side.applyUpdate(deltaOf(other, side));
    };

    x.transact(() => x.moveBlock(p2, p1, 0)); // indent under the first (append)
    y.insertText(p1, 0, "A-"); // the container's text
    y.insertText(p2, 6, "B"); // the indented block's text

    exchange(x, y);

    // Deep equality (Y.Map key order is not part of the converged state).
    expect(x.toJSON()).toEqual(y.toJSON());
    // Both changes landed on both sides: the indent and both edits.
    const final = x.toJSON();
    const textOf = (id: string): string => {
      const block = final.blocks[id]!;
      return "content" in block ? (block.content ?? []).reduce((text, run) => text + run.text, "") : "";
    };
    const container = final.blocks[p1]!;
    expect("children" in container ? container.children : null).toEqual([p2]);
    expect(textOf(p2)).toBe("secondB");
    expect(textOf(p1)).toBe("A-first");
    expect(validateDoc(final)).toEqual([]);
  });

  it("changeBlockType: container -> container keeps the children; container -> leaf is rejected", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "code-ish");
    const child = doc.insertBlock("paragraph", undefined, { parent: p });
    doc.insertText(child, 0, "kept");

    doc.changeBlockType(p, "code", { language: "ts" });
    const asCode = doc.getBlock(p);
    expect(asCode?.type).toBe("code");
    expect(doc.getChildren(p)).toEqual([child]);
    expect(doc.getText(child)).toBe("kept");
    expect(validateDoc(doc.toJSON())).toEqual([]);

    expectThrows(() => doc.changeBlockType(p, "image", { src: "blobs/x.png" }), InvalidOperationError);
    expect(doc.getBlock(p)?.type).toBe("code");
    expect(doc.getChildren(p)).toEqual([child]);
  });
});

describe("the additive posture (no text children -> no children field)", () => {
  it("a fresh doc without nested text blocks exports no children on text blocks", () => {
    const doc = newDoc();
    doc.transact(() => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "p");
      const h = doc.insertBlock("heading", { level: 2 });
      doc.insertText(h, 0, "h");
      const c = doc.insertBlock("code", { language: "ts" });
      doc.insertText(c, 0, "c");
      const l = doc.insertBlock("latex", { display: true });
      doc.insertText(l, 0, "l");
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
