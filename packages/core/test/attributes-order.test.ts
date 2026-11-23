import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidAttributeError, createDoc, fromJSON, loadDoc } from "../src/core";
import type { CreateDocOptions, Doc } from "../src/core";
import type { DocJSON } from "../src/schema";
import { attach } from "../src/sync";
import type { SyncProvider, Unsubscribe } from "../src/sync";

/** The document-attributes display order (the `DocMeta.attributesOrder` permutation). */

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

describe("the display order (attributesOrder)", () => {
  it("setAttribute appends a new key to the order (the last-added's stand); an existing key's edit keeps it", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    expect(doc.meta.attributesOrder).toEqual(["a", "b"]);
    // The existing key's value edit stands no order change.
    doc.setAttribute("a", "one");
    expect(doc.meta.attributesOrder).toEqual(["a", "b"]);
    doc.setAttribute("c", true);
    expect(doc.meta.attributesOrder).toEqual(["a", "b", "c"]);
  });

  it("removeAttribute drops the key from the order (the empty order's field stands off)", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    doc.removeAttribute("a");
    expect(doc.meta.attributesOrder).toEqual(["b"]);
    doc.removeAttribute("b");
    expect(doc.meta.attributesOrder).toBeUndefined();
  });

  it("reorderAttributes writes the permutation (one undo step) and undoes to the previous order", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    doc.setAttribute("c", 3);
    expect(doc.meta.attributesOrder).toEqual(["a", "b", "c"]);

    doc.reorderAttributes(["c", "a", "b"]);
    expect(doc.meta.attributesOrder).toEqual(["c", "a", "b"]);
    doc.undo();
    expect(doc.meta.attributesOrder).toEqual(["a", "b", "c"]);
    doc.redo();
    expect(doc.meta.attributesOrder).toEqual(["c", "a", "b"]);
  });

  it("a reorder equal to the current stand is the no-op (the stored order / the record's key order over the absence)", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));
    // Over the stored order's stand.
    doc.reorderAttributes(["a", "b"]);
    expect(changes).toEqual([]);
    // Over the record's key order's stand (the field's absence — the order's
    // rebuild after a remove that cleared the field's stand is not possible
    // over a non-empty record, so the stand is the record's keys).
    const doc2 = freshDoc({ x: "1", y: "2" });
    const off2 = doc2.onChange((change) => changes.push(change));
    const record = doc2.raw.getMap("meta").get("attributes") as Y.Map<unknown>;
    doc2.reorderAttributes([...record.keys()]);
    expect(changes).toEqual([]);
    off();
    off2();
  });

  it("reorderAttributes rejects the non-permutation (the missing / extra / duplicated key, the empty record, the non-string)", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    expect(() => doc.reorderAttributes(["a"])).toThrow(InvalidAttributeError);
    expect(() => doc.reorderAttributes(["a", "b", "zz"])).toThrow(InvalidAttributeError);
    expect(() => doc.reorderAttributes(["a", "a"])).toThrow(InvalidAttributeError);
    expect(() => doc.reorderAttributes(["a", 42] as unknown as string[])).toThrow(InvalidAttributeError);
    expect(() => freshDoc().reorderAttributes([])).toThrow(InvalidAttributeError);
  });

  it("the order round-trips over toJSON / fromJSON / loadDoc", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    doc.setAttribute("c", 3);
    doc.reorderAttributes(["c", "a", "b"]);
    const json = doc.toJSON();
    expect(json.attributesOrder).toEqual(["c", "a", "b"]);
    expect(fromJSON(json).meta.attributesOrder).toEqual(["c", "a", "b"]);
    expect(loadDoc(doc.encode()).meta.attributesOrder).toEqual(["c", "a", "b"]);
  });

  it("fromJSON normalizes the stale order (the dropped keys, the duplicates, the missing keys' append)", () => {
    const base = freshDoc({ a: "1", b: "2" });
    base.setAttribute("c", 3);
    const json = base.toJSON();
    // The stale stand: a dropped key, a duplicate, a missing key.
    const stale: DocJSON = {
      ...json,
      attributesOrder: ["zz", "a", "a", "c"], // b is missing
    };
    expect(fromJSON(stale).meta.attributesOrder).toEqual(["a", "c", "b"]);
    // The non-array's stand (the field's drop over the record's key order's fallback).
    const broken: DocJSON = { ...json, attributesOrder: "nope" as unknown as string[] };
    expect(() => fromJSON(broken)).toThrow();
  });

  it("the reorder fires the metaChanged with no block ids (the remote path's parity)", () => {
    const doc = freshDoc({ a: "1" });
    doc.setAttribute("b", 2);
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));
    doc.reorderAttributes(["b", "a"]);
    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    off();

    const state = doc.encode();
    const other = loadDoc(state);
    const remote: unknown[] = [];
    const offRemote = other.onRemoteChange((change) => remote.push(change));
    doc.reorderAttributes(["a", "b"]);
    other.applyUpdate(doc.encodeUpdate());
    expect(remote).toEqual([{ blockIds: [], metaChanged: true }]);
    expect(other.meta.attributesOrder).toEqual(["a", "b"]);
    offRemote();
  });

  it("a reorder + a value edit over the two peers converge (the whole-array LWW)", () => {
    const state = freshDoc({ a: "1" }).encode();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    doc1.setAttribute("b", 2);
    doc1.setAttribute("c", 3);
    doc1.applyUpdate(doc2.encode()); // the empty sync (the state's parity)
    doc1.reorderAttributes(["c", "b", "a"]);
    // The other peer's concurrent value edit (no order write — the edit's
    // no-op stand over the order).
    doc2.setAttribute("a", "one");
    doc1.applyUpdate(doc2.encodeUpdate());
    doc2.applyUpdate(doc1.encodeUpdate());
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
    expect(doc1.meta.attributesOrder).toEqual(["c", "b", "a"]);
    expect(doc1.meta.attributes).toEqual({ a: "one", b: 2, c: 3 });
  });

  it("one transact batch over the set + the reorder stands one wire update", () => {
    const doc = freshDoc({ a: "1" });
    const provider = new CountingProvider();
    attach(doc, provider);
    const afterAttach = provider.sent;
    doc.transact(() => {
      doc.setAttribute("b", 2);
      doc.reorderAttributes(["b", "a"]);
    });
    expect(provider.sent).toBe(afterAttach + 1);
  });
});
