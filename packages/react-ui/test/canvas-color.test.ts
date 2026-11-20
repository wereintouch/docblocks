// The figure's fill's themes' stand (the render-time's transform): the
// dark theme's light fixed fill stands the dark corridor's value (the
// hue's stand, the muted's stand), the dark's / the non-hex's / the
// light-theme's stands verbatim; the text's contrast over the
// effective fill (the explicit textColor's data's stand, the non-hex's
// inheritance's stand). Pure — the data stands the source hex (no
// CRDT's write).
import { describe, expect, it } from "vitest";

import { contrastTextOf, effectiveColorOf, parseHexFill, relativeLuminance } from "../src/canvas/canvas-color";

const lum = (hex: string): number => {
  const parts = parseHexFill(hex);
  if (parts === null) throw new Error(`not a hex: ${hex}`);
  return relativeLuminance(parts.r, parts.g, parts.b);
};

describe("effectiveColorOf (the fill's themes' stand)", () => {
  it("the light theme stands every fill verbatim (the fidelity's stand)", () => {
    expect(effectiveColorOf("#dae8fc", false)).toBe("#dae8fc");
    expect(effectiveColorOf("#1a1a1a", false)).toBe("#1a1a1a");
    expect(effectiveColorOf("var(--docblocks-palette-blue)", false)).toBe("var(--docblocks-palette-blue)");
    expect(effectiveColorOf(undefined, false)).toBeUndefined();
  });

  it("the dark theme stands the light fixed fill darkened (the hue's stand, the muted's stand)", () => {
    const darkened = effectiveColorOf("#dae8fc", true);
    expect(darkened).not.toBe("#dae8fc");
    expect(darkened).toMatch(/^#[0-9a-f]{6}$/);
    // The dark corridor's stand: the luminance over the dark's (the
    // threshold's under), the hue's blue's stand (the b's channel over
    // the r's).
    expect(lum(darkened!)).toBeLessThan(0.1);
    const parts = parseHexFill(darkened!)!;
    expect(parts.b).toBeGreaterThan(parts.r);
  });

  it("the white's fill stands the dark neutral (the hue-less's stand)", () => {
    const darkened = effectiveColorOf("#ffffff", true);
    const parts = parseHexFill(darkened!)!;
    expect(parts.r).toBe(parts.g);
    expect(parts.g).toBe(parts.b);
    expect(lum(darkened!)).toBeLessThan(0.1);
  });

  it("the mid-dark's fill (the #E05243's stand) stands darkened over the dark theme", () => {
    expect(lum("#E05243")).toBeGreaterThan(0.2);
    const darkened = effectiveColorOf("#E05243", true);
    expect(darkened).not.toBe("#e05243".toLowerCase() === "#E05243" ? "#E05243" : "#E05243");
    expect(darkened).not.toBe("#E05243");
    expect(lum(darkened!)).toBeLessThan(0.1);
  });

  it("the dark's fill stands pass-through (the already-dark's stand)", () => {
    expect(effectiveColorOf("#1a1a1a", true)).toBe("#1a1a1a");
    expect(effectiveColorOf("#000000", true)).toBe("#000000");
  });

  it("the non-hex's stands stand pass-theme (the adaptive's stand on its own)", () => {
    expect(effectiveColorOf("var(--docblocks-palette-blue)", true)).toBe("var(--docblocks-palette-blue)");
    expect(effectiveColorOf("rgba(9, 105, 218, 0.2)", true)).toBe("rgba(9, 105, 218, 0.2)");
    expect(effectiveColorOf(undefined, true)).toBeUndefined();
  });

  it("the alpha-hex's alpha stands (the computed's RGB's darkened, the alpha's preserved)", () => {
    const darkened = effectiveColorOf("#dae8fc80", true);
    expect(darkened).toMatch(/^#[0-9a-f]{8}$/);
    expect(darkened!.slice(7, 9)).toBe("80");
    // The light theme's stand (the verbatim — the alpha's stand).
    expect(effectiveColorOf("#dae8fc80", false)).toBe("#dae8fc80");
  });

  it("the 3-digit's hex stands the darkened's (the normalization's stand)", () => {
    const darkened = effectiveColorOf("#fff", true);
    expect(darkened).toMatch(/^#[0-9a-f]{6}$/);
    expect(darkened).not.toBe("#ffffff");
  });
});

describe("contrastTextOf (the text's contrast over the effective fill)", () => {
  it("the light fill stands the black (the light theme's foreground's parity)", () => {
    expect(contrastTextOf("#dae8fc", false)).toBe("#000000");
    expect(contrastTextOf("#ffffff", false)).toBe("#000000");
  });

  it("the dark fill stands the white (the contrast's stand — the hole's fix over the light theme)", () => {
    expect(contrastTextOf("#1a1a1a", false)).toBe("#ffffff");
    expect(contrastTextOf("#000000", false)).toBe("#ffffff");
  });

  it("the dark theme's darkened fill stands the white (the effective fill's stand)", () => {
    expect(contrastTextOf("#dae8fc", true)).toBe("#ffffff");
    expect(contrastTextOf("#ffffff", true)).toBe("#ffffff");
  });

  it("the dark theme's pass-through dark fill stands the white (the readable's stand)", () => {
    expect(contrastTextOf("#1a1a1a", true)).toBe("#ffffff");
  });

  it("the non-hex's / the absent's fill stands the inheritance (the null's stand)", () => {
    expect(contrastTextOf(undefined, false)).toBeNull();
    expect(contrastTextOf(undefined, true)).toBeNull();
    expect(contrastTextOf("var(--docblocks-palette-blue)", false)).toBeNull();
    expect(contrastTextOf("var(--docblocks-palette-blue)", true)).toBeNull();
  });
});
