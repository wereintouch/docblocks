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

  it("accepts the supported value forms (incl. the mention reference)", () => {
    const doc = freshDoc();
    doc.setAttribute("s", "text");
    doc.setAttribute("n", 42);
    doc.setAttribute("b", false);
    doc.setAttribute("list", ["a", "b"]);
    doc.setAttribute("author", { id: "u1", label: "Alice" });
    expect(doc.meta.attributes).toEqual({
      author: { id: "u1", label: "Alice" },
      b: false,
      list: ["a", "b"],
      n: 42,
      s: "text",
    });
  });

  it("rejects a malformed mention reference (the { id, label } form only)", () => {
    const doc = freshDoc();
    expect(() => doc.setAttribute("author", { id: "u1" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "u1", label: "A", extra: 1 } as never)).toThrow(
      InvalidAttributeError
    );
    expect(() => doc.setAttribute("author", { id: 1, label: "A" } as never)).toThrow(InvalidAttributeError);
    expect(() => doc.setAttribute("author", { id: "", label: "A" } as never)).toThrow(InvalidAttributeError);
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
