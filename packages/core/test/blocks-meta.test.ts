import { describe, expect, it } from "vitest";

import { createDoc, fromJSON } from "../src/core";
import type { Doc } from "../src/core";

const CREATED_AT = "2026-01-01T00:00:00Z";

const newDoc = (): Doc => createDoc({ id: "r", createdAt: CREATED_AT });

describe("setTitle", () => {
  it("replaces the title in meta and JSON", () => {
    const doc = newDoc();
    doc.setTitle("First");
    expect(doc.meta.title).toBe("First");
    expect(doc.toJSON().title).toBe("First");
    doc.setTitle("Second");
    expect(doc.meta.title).toBe("Second");
    doc.setTitle("");
    expect(doc.meta.title).toBe("");
    expect(doc.toJSON().title).toBe("");
  });
});

describe("setAvatar", () => {
  it("sets and clears the avatar in meta and JSON", () => {
    const doc = newDoc();
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
    doc.setAvatar("🦊");
    expect(doc.meta.avatar).toBe("🦊");
    expect(doc.toJSON().avatar).toBe("🦊");
    doc.setAvatar(null);
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
    // The empty string is the clear stand, like null.
    doc.setAvatar("x");
    doc.setAvatar("");
    expect(doc.meta.avatar).toBeUndefined();
    expect(doc.toJSON().avatar).toBeUndefined();
  });

  it("round-trips the avatar through JSON", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const json = doc.toJSON();
    expect(json.avatar).toBe("🦊");
    const restored = fromJSON(json);
    expect(restored.meta.avatar).toBe("🦊");
    expect(restored.toJSON().avatar).toBe("🦊");
    // The absent avatar stands off the JSON (no field).
    const bare = newDoc();
    expect("avatar" in bare.toJSON()).toBe(false);
  });

  it("one undo step per commit (the undo reverts the write, the redo reapplies)", () => {
    const doc = newDoc();
    doc.setAvatar("A");
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
    doc.redo();
    expect(doc.meta.avatar).toBe("A");
    // The clear is its own step (the undo restores the value).
    doc.setAvatar(null);
    doc.undo();
    expect(doc.meta.avatar).toBe("A");
  });

  it("the no-op stand (the same value) writes nothing (no undo step, no wire update)", () => {
    const doc = newDoc();
    doc.setAvatar("A");
    const settled = doc.encode();
    doc.setAvatar("A"); // the no-op stand
    // The no-op stand emits no wire update (the doc's state is unchanged).
    expect(doc.encode()).toStrictEqual(settled);
    // No undo step was created by the no-op: one undo reverts the "A" write.
    doc.undo();
    expect(doc.meta.avatar).toBeUndefined();
  });

  it("reads stay plain snapshots after setAvatar", () => {
    const doc = newDoc();
    doc.setAvatar("🦊");
    const meta = doc.meta;
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});

describe("command guarantees", () => {
  it("same commands + injected id + counter generateId -> equal toJSON (determinism)", () => {
    const make = (): Doc => {
      let n = 0;
      return createDoc({ id: "d", createdAt: CREATED_AT, generateId: () => `b${n++}` });
    };
    const run = (doc: Doc): void => {
      const p = doc.insertBlock("paragraph");
      doc.insertText(p, 0, "hello world");
      const h = doc.insertBlock("heading", { level: 2 });
      doc.moveBlock(h, doc.meta.id, 0);
      doc.setMark(p, 0, 5, { type: "bold" });
      doc.updateBlock(h, { level: 3 });
      doc.deleteText(p, 6, 11);
      doc.setTitle("T");
    };
    const first = make();
    const second = make();
    run(first);
    run(second);
    expect(first.toJSON()).toEqual(second.toJSON());
  });

  it("reads stay plain snapshots after commands", () => {
    const doc = newDoc();
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "ab", { bold: true });
    doc.insertText(p, 2, "cd");
    doc.setMark(p, 0, 4, { type: "color", value: "#112233" });
    const block = doc.getBlock(p);
    expect(block).not.toBeNull();
    expect(JSON.parse(JSON.stringify(block))).toEqual(block);
    expect(JSON.parse(JSON.stringify(doc.getRuns(p)))).toEqual(doc.getRuns(p));
    expect(JSON.parse(JSON.stringify(doc.toJSON()))).toEqual(doc.toJSON());
  });

  it("no-op commands emit zero updates", () => {
    const doc = newDoc();
    const h = doc.insertBlock("heading", { level: 2 });
    const p = doc.insertBlock("paragraph");
    doc.insertText(p, 0, "abc");
    const before = doc.encode().byteLength;
    doc.updateBlock(h, {}); // empty patch
    doc.insertText(p, 1, ""); // empty text
    doc.deleteText(p, 1, 1); // from === to, in range
    doc.setMark(p, 1, 1, { type: "bold" }); // from === to, in range
    doc.unsetMark(p, 1, 1, "bold");
    expect(doc.encode().byteLength).toBe(before);
  });
});
