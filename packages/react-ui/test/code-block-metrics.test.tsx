// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { measureCodeLines } from "../src/blocks/code/code-metrics";

describe("measureCodeLines", () => {
  it("returns null without a measurable layout (the static fallback)", () => {
    const inner = document.createElement("div");
    inner.textContent = "a";
    document.body.appendChild(inner);
    // jsdom's computed line-height is "normal" (unparseable): the metric
    // is unavailable, the static stack stands.
    expect(measureCodeLines(inner, "a")).toBeNull();
  });

  it("measures the wrapped continuations into the logical line's height", () => {
    const inner = document.createElement("div");
    // line 0: "aa" (one visual line), line 1: "bccc" (two visual lines —
    // the wrap), line 2: "" (an empty line at the pitch).
    inner.textContent = "aa\nbccc\n";
    document.body.appendChild(inner);
    const innerRect = {
      top: 100,
      left: 0,
      right: 300,
      bottom: 177,
      width: 300,
      height: 77,
      x: 0,
      y: 100,
      toJSON: () => undefined,
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(innerRect as DOMRect);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ lineHeight: "25.6px" } as CSSStyleDeclaration);
    const rectAt = (dy: number) => new DOMRect(0, 100 + dy, 10, 18) as DOMRect;
    const original = Range.prototype.getClientRects?.bind(Range.prototype);
    Object.defineProperty(Range.prototype, "getClientRects", {
      value: function (this: Range) {
        const text = this.toString();
        if (text === "aa") return [rectAt(0)] as DOMRect[];
        if (text === "bccc") return [rectAt(25.6), rectAt(51.2)] as DOMRect[];
        return [] as DOMRect[];
      },
      writable: true,
      configurable: true,
    });
    try {
      const metrics = measureCodeLines(inner, "aa\nbccc\n");
      // The tops are rounded to whole pixels (the dedup key) — the empty
      // line 3 stacks at the rounded pitch of the measured line 2.
      expect(metrics).toEqual([
        { top: 0, height: 25.6 },
        { top: 26, height: 51.2 },
        { top: 77.2, height: 25.6 },
      ]);
    } finally {
      if (original === undefined) {
        delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects;
      } else {
        Object.defineProperty(Range.prototype, "getClientRects", {
          value: original,
          writable: true,
          configurable: true,
        });
      }
      vi.restoreAllMocks();
    }
  });
});
