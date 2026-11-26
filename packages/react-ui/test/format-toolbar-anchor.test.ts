// @vitest-environment jsdom
// The format bar's anchoring: the placement over the selection's rect, never
// above the editor root's upper edge (the consumer's chrome stands there),
// and the unmeasurable range's stand — the canvas/page switch re-seats the
// selection over a re-mounted page, so the DOM carries no rect and the bar
// keeps its last position instead of anchoring off the page origin.
import { afterEach, describe, expect, it, vi } from "vitest";

import { anchorFormatToolbar } from "../src/editing/format-toolbar/format-toolbar-anchor";

const ROOT_RECT = { top: 100, left: 0, width: 600, height: 400 };

/** The engine's range geometry (jsdom stands none): stubbed per test. */
const rectStub = (rect: { top: number; bottom: number; left: number; width: number; height: number }) => {
  Range.prototype.getBoundingClientRect = vi.fn(() => ({
    ...rect,
    right: rect.left + rect.width,
    x: rect.left,
    y: rect.top,
    toJSON: () => rect,
  })) as unknown as () => DOMRect;
};

/** The editor root's box (jsdom lays nothing out). */
const elementStub = (el: HTMLElement, rect: { top: number; left: number; width: number; height: number }) => {
  el.getBoundingClientRect = () =>
    ({ ...rect, bottom: rect.top + rect.height, right: rect.left + rect.width, x: rect.left, y: rect.top }) as DOMRect;
};

/** Drops the mounted roots (a case mounting several stands). */
function cleanupDom(): void {
  document.body.innerHTML = "";
}

afterEach(() => {
  cleanupDom();
  // The engine's geometry is the stub's stand only (jsdom has none).
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
  window.getSelection()?.removeAllRanges();
});

/** The editor root, the bar, and a selection inside the root carrying `rect`. */
function mountBar(rect: { top: number; bottom: number; left: number; width: number; height: number }) {
  const root = document.createElement("div");
  root.textContent = "the page text";
  const bar = document.createElement("div");
  root.append(bar);
  document.body.append(root);
  elementStub(root, ROOT_RECT);
  rectStub(rect);
  const range = document.createRange();
  range.selectNodeContents(root.firstChild!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return { root, bar };
}

describe("the format bar's anchoring", () => {
  it("an unmeasurable range (a zero rect) stands no anchor and keeps the bar's position", () => {
    const { root, bar } = mountBar({ top: 0, bottom: 0, left: 0, width: 0, height: 0 });
    anchorFormatToolbar(bar, root);
    expect(bar.style.top).toBe("");
    expect(bar.style.left).toBe("");
  });

  it("an unmeasurable range keeps the position the bar already stands at", () => {
    const { root, bar } = mountBar({ top: 0, bottom: 0, left: 0, width: 0, height: 0 });
    bar.style.left = "40px";
    bar.style.top = "60px";
    anchorFormatToolbar(bar, root);
    expect(bar.style.left).toBe("40px");
    expect(bar.style.top).toBe("60px");
  });

  it("a runtime without range geometry (the unit stand) writes no position", () => {
    const { root, bar } = mountBar({ top: 300, bottom: 320, left: 100, width: 50, height: 20 });
    // jsdom's own stand: no `Range.prototype.getBoundingClientRect`.
    delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    anchorFormatToolbar(bar, root);
    expect(bar.style.top).toBe("");
    expect(bar.style.left).toBe("");
  });

  it("a measured range places the bar above it", () => {
    const { root, bar } = mountBar({ top: 300, bottom: 320, left: 100, width: 50, height: 20 });
    anchorFormatToolbar(bar, root);
    // The bar's box stands unlaid-out (the offset's stand): the gap only.
    expect(bar.style.top).toBe("192px");
    expect(bar.style.left).toBe("125px");
  });

  it("the bar never stands above the editor root's upper edge (the consumer's chrome)", () => {
    // The selection's box sits above the root (an inner scroller, a stale
    // layout): the calculated stand would be negative.
    const { root, bar } = mountBar({ top: 50, bottom: 60, left: 100, width: 50, height: 10 });
    anchorFormatToolbar(bar, root);
    expect(bar.style.top).toBe("8px");
  });

  it("the bar stays inside the root's width (the horizontal clamp)", () => {
    const far = mountBar({ top: 300, bottom: 320, left: 900, width: 50, height: 20 });
    anchorFormatToolbar(far.bar, far.root);
    expect(far.bar.style.left).toBe("592px");
    cleanupDom();
    const near = mountBar({ top: 300, bottom: 320, left: 0, width: 4, height: 20 });
    anchorFormatToolbar(near.bar, near.root);
    expect(near.bar.style.left).toBe("8px");
  });

  it("the bar overhangs the content's bottom (no chrome there): a first-line selection stands below it", () => {
    const { root, bar } = mountBar({ top: 110, bottom: 130, left: 100, width: 50, height: 20 });
    anchorFormatToolbar(bar, root);
    expect(bar.style.top).toBe("38px");
  });

  it("a selection outside the root stands no anchor (the bar is not its surface)", () => {
    const { root, bar } = mountBar({ top: 300, bottom: 320, left: 100, width: 50, height: 20 });
    const outside = document.createElement("p");
    outside.textContent = "the consumer's own text";
    document.body.append(outside);
    const range = document.createRange();
    range.selectNodeContents(outside.firstChild!);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    anchorFormatToolbar(bar, root);
    expect(bar.style.top).toBe("");
    expect(bar.style.left).toBe("");
  });
});
