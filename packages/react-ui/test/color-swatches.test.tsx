// @vitest-environment jsdom
// The shared color palette primitive (the single row of circular swatches
// behind the format + shape + connector + table palettes): the default
// stand (eight swatches — the seven pastel theme tokens, then the theme's
// background), the selected accent border, the opt-in transparent / custom swatches (off by default),
// and the `formatPalette` override. The shipped token contract (the seven
// pastel tokens' light / dark pairs) is pinned in styles-css.test.ts (the
// static stylesheet read, the node environment).
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FORMAT_PALETTE } from "../src/editing/format-toolbar";
import { ColorSwatches } from "../src/shared/ui/ColorSwatches";
import { colorToHex, normalizeHex, rgbToHex } from "../src/shared/ui/color-utils";

afterEach(cleanup);

// The palette entries a jsdom render can resolve deterministically (hex pass
// through; the default's theme tokens are not resolvable in jsdom).
const HEX_PALETTE = ["#e11d48", "#f59e0b", "#3b82f6"];

function swatches() {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/palette-swatch"]'));
}

describe("the color utilities (the entry → hex resolution)", () => {
  // The fast path (an `rgb()` / `rgba()` computed color) converts directly;
  // the canvas round-trip (the `oklch(…)` / `lab(…)` stand) is pinned in the
  // e2e over the real browser (jsdom has no 2D context).
  it("colorToHex converts an rgb()/rgba() string to a hex", () => {
    expect(colorToHex("rgb(201, 106, 106)")).toBe("#c96a6a");
    expect(colorToHex("rgb(247, 168, 168)")).toBe("#f7a8a8");
    expect(colorToHex("rgba(255, 0, 0, 0.5)")).toBe("#ff000080");
    expect(colorToHex("rgba(0, 0, 0, 0)")).toBe("#00000000");
  });

  it("colorToHex stands null for an unresolvable / non-DOM color", () => {
    // jsdom has no 2D context, so a non-rgb color (the oklch stand) cannot
    // round-trip and stands null (a real browser resolves it).
    expect(colorToHex("oklch(0.145 0 0)")).toBeNull();
  });

  it("normalizeHex / rgbToHex (the primitives)", () => {
    expect(normalizeHex("#C96A6A")).toBe("#c96a6a");
    expect(normalizeHex("#c96a")).toBe("#c96a");
    expect(normalizeHex("rgb(1, 2, 3)")).toBeNull();
    expect(rgbToHex("rgb(1, 2, 3)")).toBe("#010203");
  });
});

describe("ColorSwatches (the shared palette)", () => {
  it("stands the default palette's eight swatches in order, one line", () => {
    render(<ColorSwatches colors={FORMAT_PALETTE} onSelect={() => undefined} label="fill" />);
    const els = swatches();
    // The seven pastel tokens + the theme's background token.
    expect(els.length).toBe(8);
    expect(els.map((el) => el.dataset.color)).toEqual([
      "var(--docblocks-palette-red)",
      "var(--docblocks-palette-orange)",
      "var(--docblocks-palette-yellow)",
      "var(--docblocks-palette-green)",
      "var(--docblocks-palette-cyan)",
      "var(--docblocks-palette-blue)",
      "var(--docblocks-palette-violet)",
      "var(--background)",
    ]);
    // Circles in a single line (the group is a flex row, the swatches round).
    const group = els[0]!.parentElement!;
    expect(group.getAttribute("role")).toBe("group");
    expect(group.className).toContain("flex");
    els.forEach((el) => expect(el.className).toContain("rounded-full"));
    // The default palette stands no none / custom swatch (both opt-in, off).
    expect(document.querySelector('[data-slot="docblocks/palette-none"]')).toBeNull();
    expect(document.querySelector('[data-slot="docblocks/palette-custom"]')).toBeNull();
  });

  it("the selected swatch stands the accent border (a hex palette)", () => {
    render(<ColorSwatches colors={HEX_PALETTE} current="#f59e0b" onSelect={() => undefined} label="fill" />);
    const els = swatches();
    expect(els.length).toBe(3);
    // The middle swatch (the current value) is pressed with the accent
    // border; the others stand the thin theme border.
    expect(els[1]!.getAttribute("aria-pressed")).toBe("true");
    expect(els[1]!.className).toContain("border-(--primary)");
    expect(els[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(els[0]!.className).toContain("border-(--border)");
    expect(els[2]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("stands no swatch selected when the current value matches no entry", () => {
    render(<ColorSwatches colors={HEX_PALETTE} current="#123456" onSelect={() => undefined} label="fill" />);
    swatches().forEach((el) => expect(el.getAttribute("aria-pressed")).toBe("false"));
  });

  it("a hex swatch press reports the resolved hex (one commit)", () => {
    const values: string[] = [];
    const { unmount } = render(
      <ColorSwatches colors={HEX_PALETTE} onSelect={(value) => values.push(value)} label="fill" />
    );
    screen.getByLabelText("fill color 3").click();
    expect(values).toEqual(["#3b82f6"]);
    unmount();
  });

  it("the transparent swatch is opt-in (off by default, on: theme background + the diagonal)", () => {
    // Off by default.
    render(<ColorSwatches colors={HEX_PALETTE} onSelect={() => undefined} label="fill" />);
    expect(document.querySelector('[data-slot="docblocks/palette-none"]')).toBeNull();
    cleanup();

    // On: a theme-background circle crossed by a thin diagonal (the
    // --destructive token).
    const noneClicked: boolean[] = [];
    render(
      <ColorSwatches
        colors={HEX_PALETTE}
        onSelect={() => undefined}
        label="fill"
        allowNone
        noneActive
        onSelectNone={() => noneClicked.push(true)}
      />
    );
    const none = document.querySelector<HTMLElement>('[data-slot="docblocks/palette-none"]');
    expect(none).not.toBeNull();
    expect(none!.getAttribute("aria-label")).toBe("No color");
    expect(none!.getAttribute("aria-pressed")).toBe("true");
    // The theme's background token (light on light, dark on dark) and the
    // diagonal (the destructive token).
    expect(none!.style.background).toBe("var(--background, #ffffff)");
    const diagonal = none!.querySelector<HTMLElement>("span[aria-hidden]");
    expect(diagonal).not.toBeNull();
    expect(diagonal!.className).toContain("bg-(--destructive)");
    expect(diagonal!.className).toContain("rotate-45");
    none!.click();
    expect(noneClicked).toEqual([true]);
  });

  it("the custom swatch is opt-in (off by default, on: the rainbow circle)", () => {
    // Off by default.
    render(<ColorSwatches colors={HEX_PALETTE} onSelect={() => undefined} label="fill" />);
    expect(document.querySelector('[data-slot="docblocks/palette-custom"]')).toBeNull();
    cleanup();

    // On: a rainbow circle that reports the press (the picker opens on first
    // use — built elsewhere).
    const customClicked: boolean[] = [];
    render(
      <ColorSwatches
        colors={HEX_PALETTE}
        onSelect={() => undefined}
        label="fill"
        allowCustom
        onCustom={() => customClicked.push(true)}
      />
    );
    const custom = document.querySelector<HTMLElement>('[data-slot="docblocks/palette-custom"]');
    expect(custom).not.toBeNull();
    expect(custom!.getAttribute("aria-label")).toBe("Custom color");
    // The rainbow gradient fill (the picker's affordance).
    expect(custom!.style.background).toContain("conic-gradient");
    custom!.click();
    expect(customClicked).toEqual([true]);
  });

  it("a consumer formatPalette override stands (the entries render as-is)", () => {
    const override = ["#123456", "#654321"];
    render(<ColorSwatches colors={override} onSelect={() => undefined} label="fill" />);
    expect(swatches().map((el) => el.dataset.color)).toEqual(override);
  });
});
