import { describe, expect, it } from "vitest";

import { InvalidAttrsError, UnknownBlockError, createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";
import { validateDoc } from "../src/schema";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

describe("the attr removal (removeBlockAttr)", () => {
  it("removes one attr, keeping the rest; the last attr's removal stands the omitted field", () => {
    const doc = newDoc();
    const co = doc.insertBlock("code", { language: "ts", lineNumbers: true });
    doc.removeBlockAttr(co, "lineNumbers");
    expect(doc.getBlock(co)).toEqual({ type: "code", attrs: { language: "ts" } });

    // The last attr: the read stands the omitted `attrs` field (the
    // empty map's read rule) — the JSON keeps the same shape as the
    // never-set stand.
    doc.removeBlockAttr(co, "language");
    const block = doc.getBlock(co);
    expect(block).not.toBeNull();
    expect(block).toEqual({ type: "code" });
    expect((doc.toJSON().blocks[co] as { attrs?: unknown }).attrs).toBeUndefined();
    expect(validateDoc(doc.toJSON())).toEqual([]);
  });

  it("the post-removal attrs keep the registry's invariants (the required attr's removal is a rejection)", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2, align: "center" });
    expect(() => doc.removeBlockAttr(h, "level")).toThrow(InvalidAttrsError);
    // The rejected removal is a no-op: the block stands.
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2, align: "center" } });
  });

  it("an absent key is the no-op stand (no write, no event, no stamp)", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));
    const stamp = doc.lastUpdatedAt;

    doc.removeBlockAttr(h, "no-such-key");
    doc.removeBlockAttr(h, "no-such-key");

    expect(changes).toEqual([]);
    expect(doc.lastUpdatedAt).toBe(stamp);
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2 } });
    off();
  });

  it("one command = one undo step; the undo restores the attr", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    doc.updateBlock(h, { align: "right" });
    doc.removeBlockAttr(h, "align");
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2 } });

    doc.undo();
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2, align: "right" } });
    doc.undo();
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2 } });
  });

  it("throws the typed errors: the unknown block, the no-attrs type", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    expect(() => doc.removeBlockAttr("no-such-block", "level")).toThrow(UnknownBlockError);
    // The root block has no attrs (the registry's stand; the doc id is
    // the root block's id).
    const root = "r";
    expect(() => doc.removeBlockAttr(root, "any")).toThrow(InvalidAttrsError);
    // The rejected command is a no-op: the block stands.
    expect(doc.getBlock(h)).toEqual({ type: "heading", attrs: { level: 2 } });
  });
});

describe("callout color / icon (the preset + override)", () => {
  it("round-trips the color/icon overrides (incl. the explicit null stand)", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "warning", color: "#ff0000", icon: "lightbulb" });
    const attrs = { variant: "warning", color: "#ff0000", icon: "lightbulb" };
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs });
    expect(doc.toJSON().blocks[co]).toEqual({ type: "callout", attrs });
    // The JSON round-trip keeps the values (incl. an explicit null).
    const reloaded = fromJSON(doc.toJSON());
    expect(reloaded.getBlock(co)).toEqual({ type: "callout", attrs });
    // Clearing an override stands null (the preset), keeping the variant + the other override.
    doc.updateBlock(co, { color: null });
    expect(doc.getBlock(co)).toEqual({
      type: "callout",
      attrs: { variant: "warning", color: null, icon: "lightbulb" },
    });
    expect(doc.toJSON().blocks[co]).toEqual({
      type: "callout",
      attrs: { variant: "warning", color: null, icon: "lightbulb" },
    });
  });

  it("the preset switch (variant + the null overrides) is one transact, one undo step", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "info", color: "#ff0000", icon: "star" });
    // The preset switch: the new variant + the overrides reset to null in one
    // transact (the preset resets the individual overrides).
    doc.transact(() => doc.updateBlock(co, { variant: "danger", color: null, icon: null }));
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "danger", color: null, icon: null } });
    // One undo step restores the previous stand (the variant + the overrides).
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#ff0000", icon: "star" } });
  });

  it("the individual override keeps the variant (the preset identity), one undo each", () => {
    const doc = newDoc();
    const co = doc.insertBlock("callout", { variant: "info" });
    // An individual color override: the variant stands (the preset identity).
    doc.updateBlock(co, { color: "#00ff00" });
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00" } });
    // An individual icon override: the variant + color stand.
    doc.updateBlock(co, { icon: "heart" });
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00", icon: "heart" } });
    // One undo per individual change.
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info", color: "#00ff00" } });
    doc.undo();
    expect(doc.getBlock(co)).toEqual({ type: "callout", attrs: { variant: "info" } });
  });
});
