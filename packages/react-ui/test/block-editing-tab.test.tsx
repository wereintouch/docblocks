// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { BlockId } from "docblocks-core";

import { caretAtFlat, key, renderDoc, wrapperOf } from "./block-editing.helpers";

describe("Tab: the gesture owns the key (the focus stays in the text)", () => {
  it("a no-op Tab on the first block is suppressed — no focus escape, no doc change", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "text");
    });
    const before = JSON.stringify(doc.toJSON());
    caretAtFlat(p, 2);
    // No preceding block: the indent is impossible — the gesture is a
    // no-op, but the key is still owned (the browser's default focus move
    // to the next focusable element must not run).
    expect(key(wrapperOf(p), "Tab")).toBe(false);
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });

  it("a no-op Shift+Tab on a top-level block is suppressed", () => {
    let p: BlockId = "";
    const doc = renderDoc((d) => {
      p = d.insertBlock("paragraph");
      d.insertText(p, 0, "text");
    });
    const before = JSON.stringify(doc.toJSON());
    caretAtFlat(p, 2);
    // The top level has no outdent target.
    expect(key(wrapperOf(p), "Tab", { shiftKey: true })).toBe(false);
    expect(JSON.stringify(doc.toJSON())).toBe(before);
  });
});
