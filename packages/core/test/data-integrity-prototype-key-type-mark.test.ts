import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import { flattenDoc, validateMarkSet } from "../src/schema";
import type { DocJSON } from "../src/schema";

describe("the prototype-key type and mark stand (the registry's own-property lookup)", () => {
  // The Object.prototype-reserved names (`constructor`, `toString`, …) stand
  // unknown on every registry lookup: the `in` operator's prototype-aware
  // pass would treat them as registered entries (the inherited function,
  // not a spec). The own-property stand: the writer keeps such a type as
  // opaque data (no loss on save), the strict commands reject the
  // names, the lenient reader keeps the data.
  it("an unknown type named like a prototype key stands opaque (the save keeps the data)", () => {
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-11-03T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["k"] },
        k: { type: "constructor", attrs: { size: 3 }, content: [{ text: "kept", marks: {} }] },
      },
    };
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    // The export keeps the fields intact (the opaque stand — the registry's
    // writer never sees the reserved name as a spec entry).
    const exported = loaded.toJSON().blocks.k as { attrs?: Record<string, unknown>; content?: unknown[] };
    expect(exported.attrs).toEqual({ size: 3 });
    expect(exported.content).toEqual([{ text: "kept", marks: {} }]);
    // The re-save survives (the round trip stands — no silent loss).
    const again = loadDoc(loaded.encode());
    expect(again.toJSON().blocks.k).toEqual(exported);
  });

  it("the opaque block's own __proto__ attr stands the own property (no loss, no prototype swap)", () => {
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-11-03T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["k"] },
        // The JSON.parse stand: the object literal's `__proto__` stands the
        // prototype, not an own data key.
        k: { type: "future-type", attrs: JSON.parse('{"__proto__":{"payload":"x"},"size":3}') },
      },
    };
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    // The opaque stand (the getBlock's null stand — the data lives in the
    // export): the own key stands an own property (no loss, no prototype
    // swap — the attacker's object is the value, not the prototype).
    const attrs = (loaded.toJSON().blocks.k as { attrs?: Record<string, unknown> }).attrs;
    expect(attrs).toBeDefined();
    expect(Object.hasOwn(attrs!, "__proto__")).toBe(true);
    expect(attrs!.__proto__).toEqual({ payload: "x" });
    expect(Object.getPrototypeOf(attrs!)).toBe(Object.prototype);
    // The round trip keeps the own key (the data stands).
    const again = loadDoc(loaded.encode());
    const kept = (again.toJSON().blocks.k as { attrs?: Record<string, unknown> }).attrs;
    expect(Object.hasOwn(kept!, "__proto__")).toBe(true);
    expect(kept!.size).toBe(3);
  });

  it("flattenDoc keeps the children of the prototype-key type (the unknown type's stand)", () => {
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-11-03T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["k"] },
        k: { type: "constructor", children: ["l"] },
        l: { type: "paragraph" as const, content: [{ text: "x", marks: {} }] },
      },
    };
    const flat = flattenDoc(JSON.parse(JSON.stringify(base)) as DocJSON);
    // The unknown type stands no spec: the children order stands preserved
    // (the children are never orphaned — the function-look-up stand is gone).
    expect((flat.blocks.k as { children?: string[] }).children).toEqual(["l"]);
    expect(flat.blocks.l).toBeDefined();
  });

  it("the commands reject the prototype-key type and mark (the strict stand)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    expect(() => doc.insertBlock("constructor" as never)).toThrow(/Unknown block type/);
    expect(() => doc.changeBlockType(p, "constructor" as never, undefined as never)).toThrow(/Unknown block type/);
    doc.insertText(p, 0, "x");
    expect(() => doc.setMark(p, 0, 1, { type: "constructor" as never })).toThrow(/Unknown mark/);
    expect(() => doc.unsetMark(p, 0, 1, "constructor" as never)).toThrow(/Unknown mark/);
    expect(() => doc.insertText(p, 0, "y", { constructor: true } as never)).toThrow(/Unknown mark/);
  });

  it("changeBlockType stands the hostile attrs over the own-property merge (the reset, not the silent swap)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    doc.updateBlock(p, { align: "center" });
    // The hostile own attr over the raw (the wire's stand — the command's
    // path rejects it, the layout's does not).
    const entry = doc.raw.getMap("blocks").get(p) as Y.Map<unknown>;
    (entry.get("attrs") as Y.Map<unknown>).set("__proto__", "ok");
    // The type change: the target's whitelist does not declare the hostile
    // key (the own-property stand) — it stands reset like the rest of the
    // type-specific attrs (the change's declared-attr contract), not a
    // silent drop over the prototype's setter. The shared attr's
    // carry-over stands.
    doc.changeBlockType(p, "heading", { level: 2 });
    const block = doc.getBlock(p);
    expect(block?.type).toBe("heading");
    const attrs = (block !== null && "attrs" in block ? block.attrs : {}) as Record<string, unknown>;
    expect(Object.hasOwn(attrs, "__proto__")).toBe(false);
    expect(Object.getPrototypeOf(attrs)).toBe(Object.prototype);
    expect(attrs.level).toBe(2);
    expect(attrs.align).toBe("center");
    // The patch's hostile key stands the strict rejection (like
    // insertBlock's): the change is refused, no silent drop of the input.
    const q = doc.insertBlock("paragraph");
    expect(() => doc.changeBlockType(q, "heading", { constructor: 1 } as never)).toThrow(/Unknown attribute/);
  });

  it("the strict mark-field validation stands the own-property's lookup (the prototype name is unknown)", () => {
    // The multi-field mark (the mention's kind / id / label) with an
    // unknown field named like an Object.prototype member: the
    // prototype-aware `in` would treat it as a declared field and pass the
    // strict posture. The own-property stand rejects it.
    const hostile = { kind: "user", id: "u1", label: "x", toString: "evil" };
    const errors = validateMarkSet("paragraph", { mention: hostile });
    expect(errors).toEqual([
      { path: "marks.mention.toString", message: 'Unknown attribute "toString" for mark "mention".' },
    ]);
  });
});
