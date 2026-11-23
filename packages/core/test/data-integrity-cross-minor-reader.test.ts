import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { type Doc, InvalidSnapshotError, createDoc, fromJSON, loadDoc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { OpaqueBlock } from "../src/schema";

/** A single paragraph seeded with the text `abcdef`. */
const seedParagraph = (): { a: Doc; id: string } => {
  const a = createDoc({ id: "pin" });
  const id = a.insertBlock("paragraph");
  a.insertText(id, 0, "abcdef");
  return { a, id };
};

describe("the cross-minor reader stand", () => {
  // An unknown mark on the text: the load tolerates it and the run keeps it.
  it("an additive v1 mark survives loading (the run keeps the unknown mark)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { wavy: true });
    const restored = loadDoc(a.encode());
    // The run keeps the unknown mark (the export preserves it as-is).
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({ wavy: true });
    // The text is intact and the re-save keeps the unknown mark.
    expect(restored.getText(id)).toBe("abcdef");
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({ wavy: true });
  });

  // A future field on a KNOWN mark (the cross-minor additive): the lenient
  // load tolerates it (the validator's mark-fields stand), and the read
  // path passes it through (any value shape — the data is not lost on save).
  it("a future field on a known mark survives the lenient load (the value shape stands preserved)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({
      mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] },
    });
    expect(restored.getText(id)).toBe("abcdef");
    // The re-save keeps the future field (no loss on save).
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({
      mention: { kind: "user", id: "u1", label: "Alice", refs: ["doc-9"] },
    });
    // The strict validator (the writer's stand) rejects the unknown field.
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes('Unknown attribute "refs"'))).toBe(true);
  });

  it("a new enum value on a known mark field survives the lenient load", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: "page", id: "d9", label: "Doc" } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({ mention: { kind: "page", id: "d9", label: "Doc" } });
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({ mention: { kind: "page" } });
    // The strict validator (the writer's stand) rejects the new enum value.
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes("must be one of"))).toBe(true);
  });

  // The corruption stand: a known field with a non-string value is dropped
  // on read (a future minor cannot change a known field's contract — the
  // live view degrades gracefully, the text stands; the snapshot boundary
  // rejects the corrupted state loudly — the strict posture protects the
  // data we own).
  it("a non-string value on a known mark field stands dropped on read (the corruption stand)", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { mention: { kind: 42, id: "u1", label: "Alice" } });
    // The live view degrades gracefully: the field is dropped, the text stands.
    const runs = (a.toJSON().blocks[id] as OpaqueBlock).content;
    const mention = (runs?.[0]?.marks as Record<string, unknown> | undefined)?.mention as Record<string, unknown>;
    expect(mention).toMatchObject({ id: "u1", label: "Alice" });
    expect(mention).not.toHaveProperty("kind");
    expect(a.getText(id)).toBe("abcdef");
    // The snapshot boundary rejects the corrupted state loudly (a required
    // field stands missing after the protective drop — the load must not
    // silently stand a truncated mark).
    expect(() => loadDoc(a.encode())).toThrow(InvalidSnapshotError);
  });

  it("a future attribute on a known single-attr mark survives the lenient load", () => {
    const { a, id } = seedParagraph();
    const content = (a.raw.getMap("blocks").get(id) as Y.Map<unknown>).get("content") as Y.Text;
    content.format(0, 3, { link: { href: "https://example.com", data: { deep: true } } });
    const restored = loadDoc(a.encode());
    const runs = (restored.toJSON().blocks[id] as OpaqueBlock).content;
    expect(runs?.[0]?.marks).toMatchObject({
      link: { href: "https://example.com", data: { deep: true } },
    });
    const again = loadDoc(restored.encode());
    expect((again.toJSON().blocks[id] as OpaqueBlock).content?.[0]?.marks).toMatchObject({
      link: { data: { deep: true } },
    });
    expect(validateDoc(restored.toJSON()).some((e) => e.message.includes('Unknown attribute "data"'))).toBe(true);
  });

  // An unknown block type: the load tolerates it (opaque), the block and its
  // fields survive the round trip, and its id stays in the root order.
  it("an additive v1 type loads as opaque data and survives the round trip", () => {
    const base = createDoc({ id: "pin" });
    base.insertBlock("paragraph"); // a known child so the root order is non-empty
    const json = base.toJSON();
    const id = "future1";
    const future: OpaqueBlock = { type: "future-block", attrs: { futureFlag: "preserve-me" } };
    const root = json.blocks[json.id] as { children?: string[] };
    root.children = [...(root.children ?? []), id];
    const doc = fromJSON({ ...json, blocks: { ...json.blocks, [id]: future } });
    // The opaque block stands in the export with its fields as-is.
    expect(doc.toJSON().blocks[id]).toMatchObject({ type: "future-block", attrs: { futureFlag: "preserve-me" } });
    // The re-save (encode -> load) keeps the opaque data (no loss on save).
    const again = loadDoc(doc.encode());
    expect(again.toJSON().blocks[id]).toMatchObject({ type: "future-block", attrs: { futureFlag: "preserve-me" } });
    // The unknown type's id stays in the root order (not dropped as dangling).
    expect(again.getChildren(again.meta.id)).toContain(id);
  });
});
