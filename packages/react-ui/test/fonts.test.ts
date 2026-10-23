// The font subsystem's single place (src/fonts.ts): the UI default font
// (Inter) + the mono default + the re-exported shape font set, and the
// documented mechanism for adding a font.
import { describe, expect, it } from "vitest";

import { MONO_FONT_STACK, SHAPE_FONT_OPTIONS, SHAPE_FONT_STACKS, UI_FONT_ID, UI_FONT_STACK } from "../src/fonts";

describe("the font subsystem registry (src/fonts)", () => {
  it("stands the UI default font as the self-hosted Inter, with a system fallback", () => {
    expect(UI_FONT_ID).toBe("Inter");
    // Inter first (the self-hosted family), then the system fallbacks.
    expect(UI_FONT_STACK.startsWith("'Inter',")).toBe(true);
    expect(UI_FONT_STACK).toContain("system-ui");
    expect(UI_FONT_STACK).toContain("sans-serif");
  });

  it("stands the mono default as the system mono (unchanged by the UI-font default)", () => {
    expect(MONO_FONT_STACK.startsWith("ui-monospace,")).toBe(true);
  });

  it("re-exports the shape font set (the self-hosted families)", () => {
    const ids = SHAPE_FONT_OPTIONS.map((option) => option.id);
    expect(ids).toEqual(["Inter", "Open Sans", "PT Sans", "Lora", "PT Serif", "JetBrains Mono"]);
    // The UI default is one of the shape set's families (no duplicate woff2).
    expect(ids).toContain(UI_FONT_ID);
  });

  it("derives the shape name -> stack map, each with a Cyrillic-capable fallback", () => {
    for (const option of SHAPE_FONT_OPTIONS) {
      expect(SHAPE_FONT_STACKS[option.id]).toBe(option.stack);
      // The stack names the family first and ends in a generic fallback.
      expect(option.stack.startsWith(`'${option.id}',`)).toBe(true);
      expect(option.stack).toMatch(/(sans-serif|serif|monospace)$/);
    }
  });
});
