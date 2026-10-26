// The shipped stylesheet contract: dist/styles.css is assembled by the
// package build (the tailwindcss CLI step + scripts/assemble-styles.mjs)
// from the compiled utility layer (ui.entry.css), the standard token seed
// (theme.css), and the token mapping + structural rules (styles.css). This
// static pin keeps the shipped artifact in sync with the documented
// contract (the section order, the layered output, the seed, the `dark:`
// class variant, the use-site token mapping, and the src-pinned source
// detection).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MONO_FONT_STACK, UI_FONT_STACK } from "../src/fonts";

const STYLES_CSS = readFileSync(fileURLToPath(new URL("../dist/styles.css", import.meta.url)), "utf8");

describe("dist/styles.css contract", () => {
  it("assembles the sections in the documented order (utility layer → seed → mapping → structural)", () => {
    const order = [
      "@layer utilities", // 1. the compiled utility layer
      "--primary: oklch(0.205 0 0)", // 2. the standard seed (light)
      "--primary: oklch(0.922 0 0)", // 3. the standard seed (dark)
      '[data-slot="docblocks/editor"] {', // 4. the mapping (light)
      ':is(.dark [data-slot="docblocks/editor"]', // 5. the mapping (dark)
      '[data-slot="docblocks/row-marker"]', // 6. the structural rules
    ];
    // One pass: every section present, and each following the previous.
    let previous = -1;
    order.forEach((section, index) => {
      const position = STYLES_CSS.indexOf(section);
      expect(position, `section ${index + 1} (${section}) must be present`).toBeGreaterThan(previous);
      previous = position;
    });
  });

  it("is a layered Tailwind output (theme, base, utilities)", () => {
    expect(STYLES_CSS).toContain("@layer theme, base, components, utilities");
    expect(STYLES_CSS).toContain("@layer theme");
    expect(STYLES_CSS).toContain("@layer base");
    expect(STYLES_CSS).toContain("@layer utilities");
  });

  it("ships the preflight inside the base layer", () => {
    // The reset the shadcn component shapes assume (border-box + the
    // currentColor border default).
    expect(STYLES_CSS).toContain("box-sizing: border-box");
    expect(STYLES_CSS).toContain("border: 0 solid");
  });

  it("ships the standard token seed once (light + the .dark set)", () => {
    // The seed is a section of the assembled file, not an inlined import of
    // the utility layer: exactly one :root light set and one .dark set.
    expect(STYLES_CSS.split("--primary: oklch(0.205 0 0)").length - 1).toBe(1);
    expect(STYLES_CSS.split("--primary: oklch(0.922 0 0)").length - 1).toBe(1);
    expect(STYLES_CSS).toContain('--font-sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif');
    // The UI default font: the seed's --font-sans defaults to the self-hosted
    // Inter, and the --docblocks-font-family token's own fallback (a consumer
    // without the seed) also stands Inter. The consumer's --font-sans override
    // (the var()'s first argument) takes priority.
    expect(STYLES_CSS).toContain(
      '--docblocks-font-family: var(--font-sans, "Inter", system-ui, -apple-system, "Segoe UI", sans-serif)'
    );
  });

  it("stands the mono token unchanged (the system mono default)", () => {
    expect(STYLES_CSS).toContain("--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace");
    expect(STYLES_CSS).toContain(
      "--docblocks-mono-font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)"
    );
  });

  it("keeps the fonts-registry constants in sync with the shipped token defaults (no drift)", () => {
    // The src/fonts.ts constants mirror the stylesheet's token defaults (the
    // source of truth); this pin catches the two drifting. The CSS uses
    // double quotes, the constants single — normalize before comparing.
    const normalize = (value: string) => value.replace(/'/g, '"').replace(/\s+/g, " ").trim();
    const fallbackOf = (token: string) => {
      const declaration = STYLES_CSS.match(new RegExp(`${token}:\\s*var\\([^,]+,\\s*(.+?)\\)`))?.[1];
      return declaration === undefined ? undefined : normalize(declaration);
    };
    expect(fallbackOf("--docblocks-font-family")).toBe(normalize(UI_FONT_STACK));
    expect(fallbackOf("--docblocks-mono-font-family")).toBe(normalize(MONO_FONT_STACK));
  });

  it("compiles the dark: variant to the .dark class selector, not a media query", () => {
    expect(STYLES_CSS).toContain(":is(.dark *)");
    expect(STYLES_CSS).not.toContain("prefers-color-scheme: dark");
  });

  it("maps the utility namespaces to the standard tokens at the use site", () => {
    // `@theme inline`: the generated utilities reference var(--…) directly
    // (the editor-root mapping and the .dark flip are honored at the use
    // site), no self-emitted --color-* theme variables.
    expect(STYLES_CSS).toContain(".bg-primary {");
    expect(STYLES_CSS).toContain("background-color: var(--primary)");
    expect(STYLES_CSS).not.toContain("--color-primary:");
  });

  it("generates only the utilities the package source uses", () => {
    // Tree-shaken output: an unused palette utility is absent (the source
    // detection is pinned to the package src — nothing outside is scanned).
    expect(STYLES_CSS).not.toContain(".bg-lime-300");
    expect(STYLES_CSS).not.toContain("--color-red-500");
  });

  it("ships the enter/exit animation utilities the primitives use", () => {
    // The popup/tooltip primitives animate in and out (tw-animate-css),
    // variant-qualified (data-[state=open]:animate-in, …); a consumer of
    // the plain-CSS artifact must get the animation, not a silent pop.
    expect(STYLES_CSS).toContain("animate-in");
    expect(STYLES_CSS).toContain("animate-out");
    expect(STYLES_CSS).toContain("fade-in-0");
    expect(STYLES_CSS).toContain("zoom-in-95");
  });

  it("leaves the z-modal utility to the consumer", () => {
    // z-modal is a consumer-side stacking utility (the consumer defines it
    // — see the ui.entry.css header); the artifact must not bake in a z-index.
    expect(STYLES_CSS).not.toContain(".z-modal");
  });

  it("ships the database number cell's spin-button suppression (structural)", () => {
    // The webkit spin pseudo elements stand no utility hook — the
    // suppression ships in the structural section, scoped to the number
    // cell's data-slot (the moz appearance falls back to a plain field).
    expect(STYLES_CSS).toContain(
      '[data-slot="docblocks/database-cell"][data-kind="number"] input[type="number"]::-webkit-inner-spin-button'
    );
    expect(STYLES_CSS).toContain(
      '[data-slot="docblocks/database-cell"][data-kind="number"] input[type="number"]::-webkit-outer-spin-button'
    );
    expect(STYLES_CSS).toContain("-moz-appearance: textfield");
  });

  it("ships the page content column's max-width token (the centered stand)", () => {
    // The page view's content column stands the max width over the
    // centered stand (the consumer's override hook): the token stands a
    // literal default in the editor-root mapping, and the utility layer
    // resolves the arbitrary-value class to the var reference.
    expect(STYLES_CSS).toContain("--docblocks-page-max-width: 900px;");
    expect(STYLES_CSS).toContain("max-width: var(--docblocks-page-max-width);");
  });
});

// The color palette's shipped token contract: the seven pastel tokens stand
// a light (brighter) value in `:root` and a more muted (darker) value in
// `.dark`, so the swatch follows the theme flip (lighter on light, more
// muted on dark). The values are pinned from the assembled stylesheet.
describe("the color palette's shipped tokens (the light / dark pairs)", () => {
  const TOKENS = ["red", "orange", "yellow", "green", "cyan", "blue", "violet"] as const;

  function pairOf(name: string): { light: string; dark: string } {
    const matches = [...STYLES_CSS.matchAll(new RegExp(`--docblocks-palette-${name}: (#[0-9a-fA-F]{3,8})`, "g"))];
    expect(matches.length, `the ${name} token stands a light and a dark value`).toBe(2);
    return { light: matches[0]![1]!, dark: matches[1]![1]! };
  }

  function luminance(hex: string): number {
    const value = hex.slice(1);
    const full =
      value.length === 3
        ? value
            .split("")
            .map((c) => c + c)
            .join("")
        : value;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return 0.299 * r + 0.587 * g + 0.114 * b;
  }

  it.each(TOKENS)("the %s token stands a brighter light value and a more muted dark value", (name) => {
    const { light, dark } = pairOf(name);
    expect(luminance(light), `the light ${name} (${light}) is brighter than the dark (${dark})`).toBeGreaterThan(
      luminance(dark)
    );
    // The dark value is more muted (lower luminance) but still legible over
    // the dark popover (not near-black).
    expect(luminance(dark)).toBeGreaterThan(40);
  });

  it("ships the theme background token the eighth swatch stands (light + dark)", () => {
    // `--background` (the theme token's stand) has a light and a dark value.
    const matches = [...STYLES_CSS.matchAll(/--background: (oklch\([^)]+\)|#[0-9a-fA-F]{3,8})/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// The canvas view's dot-grid token: the alpha stands a bit more transparent
// than the first stand (the moire at the small zoom). The value is pinned from the assembled stylesheet (one named
// token — the light / dark follow `--muted-foreground`).
describe("the canvas view's dot token (the a bit more transparent alpha)", () => {
  function dotAlpha(): number {
    const match = STYLES_CSS.match(
      /--docblocks-canvas-view-dot: color-mix\(in srgb, var\(--muted-foreground, #[0-9a-fA-F]{3,8}\) (\d+(?:\.\d+)?)%, transparent\)/
    );
    expect(match, "the dot token is a color-mix over --muted-foreground").not.toBeNull();
    return Number(match![1]);
  }

  it("stands the ~20–25% alpha (a bit more transparent than the first 35% stand)", () => {
    const alpha = dotAlpha();
    expect(alpha).toBeGreaterThanOrEqual(20);
    expect(alpha).toBeLessThanOrEqual(25);
    // Clearly below the first 35% stand (the regression's target).
    expect(alpha).toBeLessThan(35);
  });
});
