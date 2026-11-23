import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { createDoc, fromJSON, loadDoc } from "../src/core";
import { attrsToMarkSet } from "../src/core/text-model";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";

describe("the reserved attr / mark key stand (the prototype pollution boundary)", () => {
  // The id-keyed dictionaries reject the reserved keys outright; the
  // key-open boundaries (the read's snapshot assembly, the command's merge,
  // the mark / attr conversions) stand the key as an OWN data property
  // instead — the `plain[key] = value` assignment with the `__proto__` key
  // reassigns the snapshot's prototype (an attacker's object whose getters
  // run on property access), the JSON export loses the data.
  it("the read boundary stands the reserved attr key as an own property (the prototype stands untouched)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "x");
    // The remote input's stand: the raw Yjs write stands no validation —
    // a crafted update carries the reserved key into the attrs map. The
    // value is an own-data object (the JSON.parse stand — the object
    // literal's `__proto__` is the prototype itself, not a data key).
    const crafted = JSON.parse('{"__proto__":{"payload":"x"},"level":2}') as Record<string, unknown>;
    const yblock = doc.raw.getMap("blocks").get(p) as Y.Map<unknown>;
    const yattrs = new Y.Map<unknown>();
    for (const [key, value] of Object.entries(crafted)) yattrs.set(key, value);
    yblock.set("attrs", yattrs);
    // The fresh load (the read boundary) stands the data neutralized.
    const loaded = loadDoc(doc.encode());
    const block = loaded.getBlock(p) as { attrs?: Record<string, unknown> } | null;
    const attrs = block?.attrs;
    expect(attrs).toBeDefined();
    expect(Object.hasOwn(attrs!, "__proto__")).toBe(true);
    // The own data key stands the value (no reassignment — the attacker's
    // object is the value, not the prototype: its members never run as the
    // snapshot's, the prototype stands Object.prototype).
    expect(attrs!.__proto__).toEqual({ payload: "x" });
    expect(Object.getPrototypeOf(attrs!)).toBe(Object.prototype);
    // The ordinary attr stands beside it, and the JSON export keeps the key
    // (the own enumerable property serializes — the round trip stands).
    expect(attrs!.level).toBe(2);
    expect(JSON.stringify(attrs)).toContain("__proto__");
  });

  it("the command's merge stands the reserved key (the caller's patch key stands strict — the rejection)", () => {
    const doc = createDoc({ id: "d" });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "x");
    // The JSON.parse stand (the object literal's `__proto__` stands the
    // prototype, not an own patch key): the own reserved key reaches the
    // merge. The writer's hybrid stand keeps the caller's
    // patch keys strict: the reserved key stands no registry spec (the
    // hasOwn stand — no inherited member), and a key the patch touches
    // that the registry does not know is the caller's unknown write — the
    // rejection (the current attrs' unknown keys stand preserved, the
    // patch's do not).
    const patch = JSON.parse('{"level":2,"__proto__":{"polluted":true}}') as Record<string, unknown>;
    expect(() => doc.updateBlock(p, patch as Parameters<typeof doc.updateBlock>[1])).toThrow(/Invalid attrs/);
  });

  it("the writer's hybrid stand: the unknown attr stands preserved, the known enum stays strict", () => {
    // A future-minor document (unknown attrs over a live sync) keeps its
    // blocks editable: the unknown key stands as own data (the lenient
    // writer's stand), the known attrs keep their full rules — a known
    // attr's enum violation still throws.
    const h = "f42";
    const json = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-11-03T00:00:00.000Z",
      blocks: {
        d: { type: "root", children: [h] },
        [h]: { type: "heading", content: [{ text: "t", marks: {} }], attrs: { level: 2, futureMinor: "x" } },
      },
    };
    const doc = fromJSON(json as DocJSON);
    // The unknown attr's update stands (no rejection), the key survives.
    doc.updateBlock(h, { level: 3 });
    expect((doc.toJSON().blocks[h] as { attrs: Record<string, unknown> }).attrs.futureMinor).toBe("x");
    // A known attr's enum violation stands strict (9 is outside the 1–6
    // enum: the runtime rejects what the TS union also rejects — the cast
    // stands the runtime path over the type's).
    expect(() => doc.updateBlock(h, { level: 9 } as unknown as Parameters<typeof doc.updateBlock>[1])).toThrow(
      /Invalid attrs/
    );
  });

  it("the reserved attr name stands no registry spec (the validator's hasOwn stand)", () => {
    // An inherited Object.prototype member (toString-class name) stands no
    // spec: the unknown-attr branch decides it (strict rejects, lenient
    // preserves the data).
    const base = {
      v: 1,
      id: "d",
      title: "t",
      createdAt: "2026-10-10T00:00:00.000Z",
      blocks: {
        d: { type: "root" as const, children: ["p"] },
        p: { type: "paragraph" as const, content: [{ text: "x", marks: {} }], attrs: { toString: 1 } },
      },
    };
    expect(validateDoc(JSON.parse(JSON.stringify(base)) as DocJSON).some((e) => e.message.includes("toString"))).toBe(
      true
    );
    const loaded = fromJSON(JSON.parse(JSON.stringify(base)) as DocJSON);
    const block = loaded.getBlock("p") as { attrs?: Record<string, unknown> } | null;
    expect(Object.hasOwn(block?.attrs ?? {}, "toString")).toBe(true);
    expect((block?.attrs as Record<string, unknown>).toString).toBe(1);
  });

  it("the crafted character attribute's reserved key stands the marks' own property (no execution)", () => {
    // The CRDT's layer (Yjs) already stands the reserved character
    // attribute key (it drops it on format — the crafted key never
    // reaches the marks over the wire); the conversion's own stand is
    // pinned directly (the boundary itself: an open key stands the own
    // property, the prototype stands untouched, the ordinary attrs stand).
    const crafted = JSON.parse('{"__proto__":{"polluted":true},"bold":true,"link":{"href":"https://x"}}') as Record<
      string,
      unknown
    >;
    const marks = attrsToMarkSet(crafted) as Record<string, unknown>;
    expect(Object.hasOwn(marks, "__proto__")).toBe(true);
    expect(marks.__proto__).toEqual({ polluted: true });
    expect(marks.bold).toBe(true);
    expect(marks.link).toEqual({ href: "https://x" });
    expect(Object.getPrototypeOf(marks)).toBe(Object.prototype);
    // The reserved mark name stands no registry spec (the hasOwn stand —
    // the inherited member stands the unknown-mark pass-through).
    const reservedName = JSON.parse('{"toString":{"x":1}}') as Record<string, unknown>;
    const marks2 = attrsToMarkSet(reservedName) as Record<string, unknown>;
    expect(Object.hasOwn(marks2, "toString")).toBe(true);
    expect(Object.getPrototypeOf(marks2)).toBe(Object.prototype);
  });
});
