import { describe, expect, it } from "vitest";

import { createDoc } from "../src/core";
import type { Doc } from "../src/core";
import type { Block } from "../src/schema";

/**
 * Fine-grained reactivity over the per-block / text observers (the sibling
 * of reactivity.test.ts): onBlock / observeText emissions, the no-phantom
 * stands, and the subscription's detach / re-attach.
 */

const CREATED_AT = "2026-01-01T00:00:00Z";

const makeIds = (prefix: string) => {
  let n = 0;
  return () => `${prefix}${n++}`;
};

/** A fresh doc with one empty paragraph (id "b0"); root id is "d1". */
const withParagraph = (): Doc => {
  const doc = createDoc({ id: "d1", createdAt: CREATED_AT, generateId: makeIds("b") });
  doc.insertBlock("paragraph");
  return doc;
};

describe("onBlock / observeText", () => {
  it("onBlock fires with a fresh snapshot and observeText with the new text", () => {
    const doc = withParagraph();
    const blocks: Block[] = [];
    const texts: string[] = [];
    const offBlock = doc.onBlock("b0", (block) => blocks.push(block));
    const offText = doc.observeText("b0", (text) => texts.push(text));

    doc.insertText("b0", 0, "hello");

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toEqual(doc.getBlock("b0"));
    expect(texts).toEqual(["hello"]);
    offBlock();
    offText();
  });

  it("observeText fires on any field change of the block", () => {
    const doc = withParagraph();
    const texts: string[] = [];
    const off = doc.observeText("b0", (text) => texts.push(text));

    doc.insertText("b0", 0, "hi");
    doc.insertBlock("paragraph"); // a change of another block: no text change here
    doc.deleteText("b0", 0, 1);

    expect(texts).toEqual(["hi", "i"]);
    off();
  });

  it("a removed block reports the empty text to observeText", () => {
    const doc = withParagraph();
    const texts: string[] = [];
    const off = doc.observeText("b0", (text) => texts.push(text));

    doc.insertText("b0", 0, "x");
    doc.removeBlock("b0");

    expect(texts).toEqual(["x", ""]);
    off();
  });

  it("emits onChange before onBlock and observeText within one transaction", () => {
    const doc = withParagraph();
    const order: string[] = [];
    const offChange = doc.onChange(() => order.push("change"));
    const offBlock = doc.onBlock("b0", () => order.push("block"));
    const offText = doc.observeText("b0", () => order.push("text"));

    doc.insertText("b0", 0, "x");

    expect(order).toEqual(["change", "block", "text"]);
    offChange();
    offBlock();
    offText();
  });
});

describe("no phantom emissions", () => {
  it("does not emit for a change-less foreign transaction", () => {
    const doc = withParagraph();
    let fired = 0;
    const off = doc.onChange(() => fired++);

    doc.raw.transact(() => {}, "someone-else");

    expect(fired).toBe(0);
    off();
  });

  it("does not emit for an empty local transact", () => {
    const doc = withParagraph();
    let fired = 0;
    const off = doc.onChange(() => fired++);

    doc.transact(() => {});

    expect(fired).toBe(0);
    off();
  });
});

describe("unsubscribe", () => {
  it("stops delivery and is safe to call twice, outside of a transaction", () => {
    const doc = withParagraph();
    let fired = 0;
    const off = doc.onChange(() => fired++);

    doc.insertText("b0", 0, "a");
    expect(fired).toBe(1);

    off();
    off(); // idempotent

    doc.insertText("b0", 1, "b");
    expect(fired).toBe(1);
  });

  it("detaches when the last subscription is removed and re-attaches on the next one", () => {
    const doc = withParagraph();
    const off1 = doc.onChange(() => {});
    const off2 = doc.onBlock("b0", () => {});

    off1();
    off2(); // all subscriptions gone: the deep observer is detached
    doc.insertText("b0", 0, "x"); // no listeners at all — must not throw

    const seen: string[] = [];
    const off3 = doc.onChange(() => seen.push("late"));
    doc.insertText("b0", 1, "y"); // re-attached: the new handler receives it
    expect(seen).toEqual(["late"]);
    off3();
  });
});
