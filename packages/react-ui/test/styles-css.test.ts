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
    expect(STYLES_CSS).toContain('--font-sans: system-ui, -apple-system, "Segoe UI", sans-serif');
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
});
