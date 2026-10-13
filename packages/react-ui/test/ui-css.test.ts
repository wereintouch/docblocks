// The compiled utility CSS contract: dist/ui.css (the `./ui.css` subpath) is
// built from ui.css by the package build (the `tailwindcss` CLI step). This
// static pin keeps the shipped artifact in sync with the documented contract
// (the layered output, the inlined token seed, the `dark:` class variant, the
// use-site token mapping, and the src-pinned source detection).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const UI_CSS = readFileSync(fileURLToPath(new URL("../dist/ui.css", import.meta.url)), "utf8");

describe("dist/ui.css contract", () => {
  it("is a layered Tailwind output (theme, base, utilities)", () => {
    expect(UI_CSS).toContain("@layer theme, base, components, utilities");
    expect(UI_CSS).toContain("@layer theme");
    expect(UI_CSS).toContain("@layer base");
    expect(UI_CSS).toContain("@layer utilities");
  });

  it("ships the preflight inside the base layer", () => {
    // The reset the shadcn component shapes assume (border-box + the
    // currentColor border default).
    expect(UI_CSS).toContain("box-sizing: border-box");
    expect(UI_CSS).toContain("border: 0 solid");
  });

  it("inlines the standard token seed (light + the .dark set)", () => {
    expect(UI_CSS).toContain("--primary: oklch(0.205 0 0)");
    expect(UI_CSS).toContain('--font-sans: system-ui, -apple-system, "Segoe UI", sans-serif');
    // The dark set flips under the `dark` class.
    const darkIndex = UI_CSS.indexOf(".dark {");
    expect(darkIndex).toBeGreaterThan(-1);
    expect(UI_CSS.slice(darkIndex)).toContain("--primary: oklch(0.922 0 0)");
  });

  it("compiles the dark: variant to the .dark class selector, not a media query", () => {
    expect(UI_CSS).toContain(":is(.dark *)");
    expect(UI_CSS).not.toContain("prefers-color-scheme: dark");
  });

  it("maps the utility namespaces to the standard tokens at the use site", () => {
    // `@theme inline`: the generated utilities reference var(--…) directly
    // (the editor-root mapping and the .dark flip are honored at the use
    // site), no self-emitted --color-* theme variables.
    expect(UI_CSS).toContain(".bg-primary {");
    expect(UI_CSS).toContain("background-color: var(--primary)");
    expect(UI_CSS).not.toContain("--color-primary:");
  });

  it("generates only the utilities the package source uses", () => {
    // Tree-shaken output: an unused palette utility is absent (the source
    // detection is pinned to the package src — nothing outside is scanned).
    expect(UI_CSS).not.toContain(".bg-lime-300");
    expect(UI_CSS).not.toContain("--color-red-500");
  });

  it("ships the enter/exit animation utilities the primitives use", () => {
    // The popup/tooltip primitives animate in and out (tw-animate-css),
    // variant-qualified (data-[state=open]:animate-in, …); a consumer of
    // the plain-CSS artifact must get the animation, not a silent pop.
    expect(UI_CSS).toContain("animate-in");
    expect(UI_CSS).toContain("animate-out");
    expect(UI_CSS).toContain("fade-in-0");
    expect(UI_CSS).toContain("zoom-in-95");
  });

  it("leaves the z-modal utility to the consumer", () => {
    // z-modal is a consumer-side stacking utility (the consumer defines it
    // — see the ui.css header); the artifact must not bake in a z-index.
    expect(UI_CSS).not.toContain(".z-modal");
  });
});
