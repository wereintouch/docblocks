import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { InvalidAttributeError, createDoc, fromJSON, loadDoc } from "../src/core";
import type { CreateDocOptions, Doc } from "../src/core";
import { validateDoc } from "../src/schema";
import type { DocJSON } from "../src/schema";
import { attach } from "../src/sync";
import type { SyncProvider, Unsubscribe } from "../src/sync";

/**
 * The document-attributes record (the `DocMeta.attributes` additive channel):
 * the round-trip over the JSON / CRDT layouts, the boundary
 * validation (the reserved keys, the value forms), the no-op stand, the
 * undo / wire accounting, the metaChanged reactivity, and the cross-minor
 * lenient preservation.
 */

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

describe("the JSON round-trip", () => {
  it("carries the attributes over toJSON / fromJSON / loadDoc, sorted by key", () => {
    const doc = freshDoc({ zeta: "z", alpha: ["a", "b"], count: 3, flag: true });
    expect(doc.meta.attributes).toEqual({ alpha: ["a", "b"], count: 3, flag: true, zeta: "z" });
    // The read is deterministic (sorted keys — the Y.Map order is not).
    expect(Object.keys(doc.meta.attributes ?? {})).toEqual(["alpha", "count", "flag", "zeta"]);

    const json = doc.toJSON();
    expect(json.attributes).toEqual({ alpha: ["a", "b"], count: 3, flag: true, zeta: "z" });

    const reimported = fromJSON(json);
    expect(reimported.meta.attributes).toEqual({ alpha: ["a", "b"], count: 3, flag: true, zeta: "z" });

    const reloaded = loadDoc(doc.encode());
    expect(reloaded.meta.attributes).toEqual({ alpha: ["a", "b"], count: 3, flag: true, zeta: "z" });
  });

  it("stands the field off for an absent or empty record (the writer's parity)", () => {
    const doc = freshDoc();
    expect(doc.meta.attributes).toBeUndefined();
    expect("attributes" in doc.toJSON()).toBe(false);

    doc.setAttribute("a", "1");
    doc.removeAttribute("a");
    // The record empties out: the read stands the field off again.
    expect(doc.meta.attributes).toBeUndefined();
    expect("attributes" in doc.toJSON()).toBe(false);
  });

  it("excludes the Yjs-only updatedAt from the JSON meta and exposes it live", () => {
    const doc = freshDoc({ a: "1" });
    expect("updatedAt" in doc.meta).toBe(false);
    const stamp = doc.lastUpdatedAt;
    if (stamp === null) throw new Error("the fresh doc stands the initial updatedAt stamp");
    expect(Number.isNaN(Date.parse(stamp))).toBe(false);
  });
});

describe("the boundary validation", () => {
  it("rejects a reserved doc-meta key at setAttribute / removeAttribute / createDoc", () => {
    const doc = freshDoc();
    for (const key of ["v", "id", "title", "avatar", "createdAt", "updatedAt"]) {
      expect(() => doc.setAttribute(key, "x")).toThrow(InvalidAttributeError);
      expect(() => doc.removeAttribute(key)).toThrow(InvalidAttributeError);
      expect(() => freshDoc({ [key]: "x" })).toThrow(InvalidAttributeError);
    }
  });

  it("rejects an Object.prototype key (the JSON round-trip would lose it)", () => {
    const doc = freshDoc();
    for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      expect(() => doc.setAttribute(key, "x")).toThrow(InvalidAttributeError);
    }
    expect(() => freshDoc({ toString: "x" })).toThrow(InvalidAttributeError);
  });

  it("rejects an empty key", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("", "x")).toThrow(InvalidAttributeError);
  });

  it("rejects an unsupported value shape (objects, number lists, non-finite numbers)", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("obj", { nested: true } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("nums", [1, 2] as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("mixed", ["a", 2] as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("nan", Number.NaN as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("inf", Number.POSITIVE_INFINITY as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("undef", undefined as never)).toThrow(InvalidAttributeError);
  });

  it("accepts the supported value forms (incl. the id-only mention reference + the typed value)", () => {
    const doc = freshDoc();
    doc.setAttribute("s", "text");
    doc.setAttribute("n", 42);
    doc.setAttribute("b", false);
    doc.setAttribute("list", ["a", "b"]);
    doc.setAttribute("createdBy", { id: "u1" });
    doc.setAttribute("legacy", { id: "u1", label: "Alice" });
    doc.setAttribute("t-string", { type: "string", value: "v" });
    doc.setAttribute("t-number", { type: "number", value: 1.5 });
    doc.setAttribute("t-boolean", { type: "boolean", value: true });
    doc.setAttribute("t-list", { type: "list", value: ["x"] });
    doc.setAttribute("t-mention", { type: "mention", value: { id: "u9" } });
    expect(doc.meta.attributes).toEqual({
      "t-boolean": { type: "boolean", value: true },
      "t-list": { type: "list", value: ["x"] },
      "t-mention": { type: "mention", value: { id: "u9" } },
      "t-number": { type: "number", value: 1.5 },
      "t-string": { type: "string", value: "v" },
      b: false,
      createdBy: { id: "u1" },
      legacy: { id: "u1", label: "Alice" },
      list: ["a", "b"],
      n: 42,
      s: "text",
    });
  });

  it("the typed value round-trips over toJSON / fromJSON (the value's form per its type)", () => {
    const json = {
      v: 1,
      id: "doc-1",
      title: "",
      createdAt: CREATED_AT,
      blocks: { "doc-1": { type: "root", children: [] } },
      attributes: {
        note: { type: "string", value: "hello" },
        rank: { type: "number", value: 3 },
        done: { type: "boolean", value: true },
        tags: { type: "list", value: ["a", "b"] },
        owner: { type: "mention", value: { id: "u1" } },
      },
    };
    const doc = fromJSON(json as never);
    expect(doc.meta.attributes).toEqual(json.attributes);
    expect(doc.toJSON().attributes).toEqual(json.attributes);
  });

  it("rejects a malformed mention reference (the id-only / legacy label form)", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("author", { id: "u1", label: "A", extra: 1 } as never)).toThrow(
      InvalidAttributeError
    );
    expect(() => doc.setAttribute("author", { id: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "u1", label: 5 } as never)).toThrow(InvalidAttributeError);
  });

  it("rejects a malformed typed value (the type's enum + the value's form per the type)", () => {
    const doc = freshDoc();
    // The type's enum + the value's form (a type/value mismatch is a rejection).
    expect(() => doc.setAttribute("a", { type: "bogus", value: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("b", { type: "number", value: "x" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("c", { type: "string", value: 1 } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("d", { type: "list", value: [1] } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("e", { type: "mention", value: { id: "" } } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("f", { type: "boolean" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("g", { type: "string", value: "v", extra: 1 } as never)).toThrow(
      InvalidAttributeError
    );
  });

  it("rejects the unsupported shapes over the strict validator and tolerates them leniently", () => {
    const json: DocJSON = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: { ok: "v", nested: { deep: 1 } },
    } as unknown as DocJSON;
    const strict = validateDoc(json);
    expect(strict.some((error) => error.path === "attributes.nested")).toBe(true);

    // The cross-minor (lenient) load preserves the unsupported value as-is.
    expect(validateDoc(json, true)).toEqual([]);
    const doc = fromJSON(json);
    expect(doc.meta.attributes?.nested).toEqual({ deep: 1 });
    // The preservation survives the export (no data loss over the round-trip).
    expect(doc.toJSON().attributes?.nested).toEqual({ deep: 1 });
  });

  it("rejects a non-object attributes record", () => {
    const json = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: ["a", "b"],
    };
    expect(validateDoc(json).some((error) => error.path === "attributes")).toBe(true);
  });

  it("rejects the broken attributesOrder over the strict validator (the non-array / the stale entry / the duplicate / the orphan) and tolerates the lenient load", () => {
    const base = {
      v: 1,
      id: "r",
      title: "T",
      createdAt: CREATED_AT,
      blocks: { r: { type: "root", children: [] } },
      attributes: { a: "1", b: "2" },
    };
    // The non-array's stand (both postures).
    expect(
      validateDoc({ ...base, attributesOrder: "nope" } as unknown as DocJSON).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    expect(
      validateDoc({ ...base, attributesOrder: "nope" } as unknown as DocJSON, true).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    // The stale entry / the duplicate / the missing key (the strict's permutation's stand).
    const stale = { ...base, attributesOrder: ["a", "a", "zz"] } as unknown as DocJSON;
    const strict = validateDoc(stale);
    expect(strict.some((error) => error.path === "attributesOrder")).toBe(true);
    expect(strict.some((error) => error.path === "attributesOrder.zz")).toBe(true);
    expect(strict.some((error) => error.path === "attributesOrder.b")).toBe(true);
    // The orphan's stand (the order over the absent record).
    expect(
      validateDoc({ ...base, attributes: undefined, attributesOrder: ["a"] } as unknown as DocJSON).some(
        (error) => error.path === "attributesOrder"
      )
    ).toBe(true);
    // The valid permutation stands the no-error over both postures.
    expect(validateDoc({ ...base, attributesOrder: ["b", "a"] } as unknown as DocJSON)).toEqual([]);
    expect(validateDoc({ ...base, attributesOrder: ["b", "a"] } as unknown as DocJSON, true)).toEqual([]);
  });
});

describe("the no-op stand", () => {
  it("a set of the current value and a remove of an absent key stand no write at all", () => {
    const doc = freshDoc({ a: "1" });
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));
    const stamp = doc.lastUpdatedAt;

    doc.setAttribute("a", "1"); // the same value
    doc.removeAttribute("zz"); // the absent key
    doc.removeAttribute("no-such-record-key");

    expect(changes).toEqual([]);
    expect(doc.lastUpdatedAt).toBe(stamp);
    off();
  });

  it("a first write (an absent record) is not a no-op", () => {
    const doc = freshDoc();
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));
    doc.setAttribute("a", "1");
    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    off();
  });
});

describe("the change accounting", () => {
  it("setAttribute / removeAttribute fire the metaChanged with no block ids", () => {
    const doc = freshDoc({ a: "1" });
    const changes: unknown[] = [];
    const off = doc.onChange((change) => changes.push(change));

    doc.setAttribute("b", 2);
    doc.removeAttribute("a");

    expect(changes).toEqual([
      { blockIds: [], metaChanged: true },
      { blockIds: [], metaChanged: true },
    ]);
    off();
  });

  it("one command = one undo step; the undo restores the attribute", () => {
    const doc = freshDoc();
    doc.setAttribute("a", "1");
    doc.setAttribute("b", 2);
    expect(doc.canUndo).toBe(true);

    doc.undo();
    expect(doc.meta.attributes).toEqual({ a: "1" });
    doc.undo();
    expect(doc.meta.attributes).toBeUndefined();

    doc.redo();
    expect(doc.meta.attributes).toEqual({ a: "1" });
    doc.redo();
    expect(doc.meta.attributes).toEqual({ a: "1", b: 2 });
  });

  it("one command = one wire update; a transact batch = one wire update", () => {
    const doc = freshDoc({ a: "1" });
    const provider = new CountingProvider();
    attach(doc, provider);
    const afterAttach = provider.sent; // the attach bootstrap

    doc.setAttribute("b", 2);
    expect(provider.sent).toBe(afterAttach + 1);

    doc.transact(() => {
      doc.setAttribute("c", true);
      doc.removeAttribute("a");
    });
    expect(provider.sent).toBe(afterAttach + 2);
  });
});

describe("the remote path", () => {
  it("a remote attribute change stands the metaChanged over onRemoteChange", () => {
    const state = freshDoc({ a: "1" }).encode();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    const changes: unknown[] = [];
    const off = doc2.onRemoteChange((change) => changes.push(change));

    doc1.setAttribute("b", 2);
    doc1.removeAttribute("a");
    // The full-state apply is one remote transaction: one merged emission
    // (the sender's two local transactions merge on the receiver).
    doc2.applyUpdate(doc1.encode());

    expect(changes).toEqual([{ blockIds: [], metaChanged: true }]);
    expect(doc2.meta.attributes).toEqual({ b: 2 });
    off();
  });
});

describe("the concurrent init", () => {
  it("two fresh docs with the same id converge over a whole-record LWW", () => {
    // A concurrent init (the server-coordinated creation stand): the two
    // docs' attribute records resolve as a whole-record LWW by client id —
    // the final state is equal on both peers.
    const a = freshDoc({ alpha: "from-a" });
    const b = freshDoc({ beta: "from-b" });
    const updateA = a.encodeUpdate();
    const updateB = b.encodeUpdate();
    a.applyUpdate(updateB);
    b.applyUpdate(updateA);
    expect(a.toJSON()).toEqual(b.toJSON());
    // The whole-record LWW: exactly one of the two records stands.
    const attributes = (a.toJSON().attributes ?? {}) as Record<string, unknown>;
    expect(["alpha", "beta"]).toContain(Object.keys(attributes)[0]);
  });

  it("a live concurrent edit of one key converges (the per-entry LWW)", () => {
    const state = freshDoc({ a: "1", b: "2" }).encode();
    const doc1 = loadDoc(state);
    const doc2 = loadDoc(state);
    doc1.setAttribute("a", "one");
    doc2.setAttribute("b", "two");
    doc1.applyUpdate(doc2.encode());
    doc2.applyUpdate(doc1.encode());
    expect(doc1.toJSON().attributes).toEqual({ a: "one", b: "two" });
    expect(doc1.toJSON()).toEqual(doc2.toJSON());
  });

  it("Y.Doc keeps the attributes map registered as a top-level type (the skeleton stand)", () => {
    const doc = freshDoc({ a: "1" });
    expect(doc.raw.getMap("meta").get("attributes")).toBeInstanceOf(Y.Map);
  });
});

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
