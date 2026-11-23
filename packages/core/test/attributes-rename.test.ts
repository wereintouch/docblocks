import { describe, expect, it } from "vitest";

import { InvalidAttributeError, createDoc, fromJSON } from "../src/core";
import type { CreateDocOptions, Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";
import { attach } from "../src/sync";
import type { SyncProvider, Unsubscribe } from "../src/sync";

/** The document-attributes rename (the `renameAttribute` command). */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

const freshDoc = (attributes?: Record<string, unknown>): Doc =>
  createDoc({
    id: "d1",
    title: "T",
    createdAt: CREATED_AT,
    generateId: makeIds("b"),
    ...(attributes !== undefined ? { attributes: attributes as CreateDocOptions["attributes"] } : {}),
  });

/** A recording transport: counts the sent wire updates (bootstrap + edits). */
class CountingProvider implements SyncProvider {
  sent = 0;
  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): void {}
  sendUpdate(): void {
    this.sent += 1;
  }
  onUpdate(): Unsubscribe {
    return () => {};
  }
  getLocalStateVector(): Uint8Array {
    return new Uint8Array(0);
  }
  setAwareness(): void {}
  onAwareness(): Unsubscribe {
    return () => {};
  }
}

describe("the rename (renameAttribute)", () => {
  it("renames the key over the value's form keep (the plain / the typed wrapper move as-is)", () => {
    const doc = freshDoc({ a: "1", n: { type: "number", value: 3 }, l: { type: "list", value: ["x"] } });
    doc.renameAttribute("a", "b");
    expect(doc.meta.attributes).toEqual({ b: "1", n: { type: "number", value: 3 }, l: { type: "list", value: ["x"] } });
    expect(doc.meta.attributes?.a).toBeUndefined();
    doc.renameAttribute("n", "m");
    expect(doc.meta.attributes?.m).toEqual({ type: "number", value: 3 });
    doc.renameAttribute("l", "k");
    expect(doc.meta.attributes?.k).toEqual({ type: "list", value: ["x"] });
  });

  it("keeps the display order's position (the entry's replacement over the order's keep)", () => {
    const doc = freshDoc({ a: "1", b: 2, c: 3 });
    doc.reorderAttributes(["c", "a", "b"]);
    doc.renameAttribute("a", "z");
    expect(doc.meta.attributesOrder).toEqual(["c", "z", "b"]);
    expect(doc.meta.attributes).toEqual({ b: 2, c: 3, z: "1" });
  });

  it("over the order's field absence stands the no-order-write (the read's key order's parity)", () => {
    const doc = freshDoc({ a: "1", b: 2 });
    doc.renameAttribute("a", "z");
    expect(doc.meta.attributesOrder).toBeUndefined();
    expect(doc.meta.attributes).toEqual({ b: 2, z: "1" });
  });

  it("is the no-op stand (the absent's source key / the same key — no write)", () => {
    const doc = freshDoc({ a: "1" });
    const provider = new CountingProvider();
    attach(doc, provider);
    const afterAttach = provider.sent;
    doc.renameAttribute("nope", "x");
    doc.renameAttribute("a", "a");
    expect(provider.sent).toBe(afterAttach);
    expect(doc.meta.attributes).toEqual({ a: "1" });
  });

  it("rejects the target's reserved / the taken key over the typed error (the record stands untouched)", () => {
    const doc = freshDoc({ a: "1", b: 2 });
    expect(() => doc.renameAttribute("a", "title")).toThrow(InvalidAttributeError);
    expect(() => doc.renameAttribute("a", "b")).toThrow(InvalidAttributeError);
    expect(() => doc.renameAttribute("a", "constructor")).toThrow(InvalidAttributeError);
    expect(doc.meta.attributes).toEqual({ a: "1", b: 2 });
  });

  it("stands one undo step (the undo restores the old key over the value's keep)", () => {
    const doc = freshDoc({ a: { type: "number", value: 5 } });
    doc.setAttribute("b", "x"); // the order's stand: [a, b]
    doc.renameAttribute("a", "z");
    expect(doc.meta.attributesOrder).toEqual(["z", "b"]);
    doc.undo();
    expect(doc.meta.attributes).toEqual({ a: { type: "number", value: 5 }, b: "x" });
    expect(doc.meta.attributesOrder).toEqual(["a", "b"]);
  });

  it("stands one wire update + the metaChanged's emission (the remote path's parity)", () => {
    const doc = freshDoc({ a: "1" });
    const provider = new CountingProvider();
    attach(doc, provider);
    const afterAttach = provider.sent;
    let metaChanged = false;
    const off = doc.onChange((change) => {
      metaChanged = metaChanged || change.metaChanged;
    });
    doc.renameAttribute("a", "b");
    off();
    expect(provider.sent).toBe(afterAttach + 1);
    expect(metaChanged).toBe(true);
  });

  it("the remote's rename converges over the sync (the value's form's keep)", () => {
    const doc1 = freshDoc({ a: { type: "number", value: 7 } });
    const doc2 = freshDoc();
    const sync = (from: Doc, to: Doc): void => {
      to.applyUpdate(from.encode());
    };
    // The doc1's state stands the doc2's bootstrap (the full-state's
    // exchange — the attach's bootstrap's parity over the in-memory stand).
    sync(doc1, doc2);
    sync(doc2, doc1);
    expect(doc2.meta.attributes).toEqual({ a: { type: "number", value: 7 } });
    doc1.renameAttribute("a", "b");
    sync(doc1, doc2);
    expect(doc2.meta.attributes).toEqual({ b: { type: "number", value: 7 } });
    expect(doc1.meta.attributes).toEqual({ b: { type: "number", value: 7 } });
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });

  it("round-trips over toJSON / fromJSON (the renamed key's parity)", () => {
    const doc = freshDoc({ a: "1" });
    doc.renameAttribute("a", "z");
    const json = doc.toJSON() as DocJSON;
    const reloaded = fromJSON(json);
    expect(reloaded.meta.attributes).toEqual({ z: "1" });
    expect(() => validateDoc(reloaded.toJSON())).not.toThrow();
  });
});
