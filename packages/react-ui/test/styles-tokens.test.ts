// The token contract: styles.css maps the standard (shadcn) input tokens
// onto the `--docblocks-*` surface on the editor root; theme.css ships the
// standard seed. This static pin keeps the documented input list in sync
// with the stylesheets (drift guard).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const STYLES = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
const THEME = readFileSync(fileURLToPath(new URL("../theme.css", import.meta.url)), "utf8");

// The standard input tokens styles.css maps (the documented mapping
// contract; the rest of the standard set is consumed by the seed / the
// shared-ui classes, not by styles.css).
const INPUT_TOKENS = [
  "--foreground",
  "--primary",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--destructive",
  "--border",
  "--card",
  "--popover",
  "--radius",
  "--font-sans",
  "--font-mono",
] as const;

// Theme-independent inputs: declared on :root only (the standard seed does
// not restate them under .dark — they inherit).
const THEME_INDEPENDENT = new Set(["--radius", "--font-sans", "--font-mono"]);

// Consumed by the seed and the shared-ui classes, not by the styles.css
// mapping: the seed must still declare them (the DS components read them
// through the compiled utility layer of the shipped styles.css).
const SEED_ONLY_TOKENS = ["--primary-foreground"] as const;

describe("styles.css token contract", () => {
  // Whitespace-normalized: the pins must survive formatting.
  const flat = STYLES.replace(/\s+/g, " ");

  it("maps every standard input token with a literal fallback", () => {
    for (const token of INPUT_TOKENS) {
      // The exact `var(<token>,` substring: a comma right after the token, so
      // `--primary` does not match through `--primary-foreground`.
      expect(STYLES, `styles.css must map ${token}`).toContain(`var(${token},`);
    }
  });

  it("pins the light mapping's fallback values (the unthemed look)", () => {
    // The fallbacks are the zero-visual-diff contract: each entry is the
    // exact var()/color-mix() reference of the light block. A drifted
    // fallback (a wrong hex base, an alpha) changes the unthemed render.
    const lightFallbackValues = [
      'var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif)',
      "var(--foreground, #1f2328)",
      "var(--muted, rgba(175, 184, 193, 0.2))",
      "var(--primary, #0969da)",
      "color-mix(in srgb, var(--primary, #0969da) 8%, transparent)",
      "var(--destructive, #cf222e)",
      "color-mix(in srgb, var(--destructive, #cf222e) 8%, transparent)",
      "var(--radius, 6px)",
      "color-mix(in srgb, var(--accent, #0969da) 8%, transparent)",
      "var(--muted-foreground, #8b949e)",
      "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace)",
      "var(--muted, rgba(175, 184, 193, 0.15))",
      "var(--border, rgba(175, 184, 193, 0.4))",
      "var(--border, #d0d7de)",
      "color-mix(in srgb, var(--muted, #afb8c1) 8%, transparent)",
      "var(--card, #ffffff)",
      "color-mix(in srgb, var(--muted-foreground, #afb8c1) 35%, transparent)",
      "var(--popover, #ffffff)",
    ];
    for (const value of lightFallbackValues) {
      expect(flat, `styles.css must carry the fallback ${value}`).toContain(value);
    }
  });

  it("declares the mapping on the editor root, not on :root", () => {
    // A :root-declared var() indirection resolves at computed-value time on
    // :root and would pin the light value — the .dark flip of the inputs
    // never reaches it.
    expect(STYLES).not.toMatch(/^:root\s*\{/m);
    expect(STYLES).toMatch(/\[data-slot="docblocks\/editor"\]\s*\{/);
  });

  it("carries the dark mapping under the .dark scope (ancestor or self)", () => {
    expect(STYLES).toMatch(/:is\(\.dark \[data-slot="docblocks\/editor"\], \[data-slot="docblocks\/editor"\]\.dark\)/);
  });
});

describe("theme.css seed", () => {
  const rootBlock = THEME.slice(THEME.indexOf(":root {"), THEME.indexOf(".dark {"));
  const darkBlock = THEME.slice(THEME.indexOf(".dark {"));

  it("declares every standard token on :root (and the theme-dependent ones on .dark)", () => {
    for (const token of INPUT_TOKENS) {
      const re = new RegExp(`^\\s*${token}:`, "m");
      expect(rootBlock, `theme.css :root must declare ${token}`).toMatch(re);
      if (!THEME_INDEPENDENT.has(token)) {
        expect(darkBlock, `theme.css .dark must declare ${token}`).toMatch(re);
      }
    }
  });

  it("declares the seed-only tokens on :root and .dark", () => {
    for (const token of SEED_ONLY_TOKENS) {
      const re = new RegExp(`^\\s*${token}:`, "m");
      expect(rootBlock, `theme.css :root must declare ${token}`).toMatch(re);
      expect(darkBlock, `theme.css .dark must declare ${token}`).toMatch(re);
    }
  });
});
