// The document header's mode switcher (the page/canvas's sliding pill): the
// switch drives the pane's editor view (the view state — no data write), and
// the pill stands the soft-highlight token over both themes (the active icon
// the foreground).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** The pane's doc JSON (a stable string — the no-data-write pin). */
async function jsonOf(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return "";
      return JSON.stringify(doc.toJSON());
    },
    { client }
  );
}

test("the mode switcher drives the pane's editor view (the pill stands over the active mode)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-header-view");
  try {
    const docArea = a.locator('[data-testid="doc-a"]');
    // The page view is the default: the page flows (no page miniature).
    await expect(docArea.locator('[data-slot="docblocks/page-card"]')).toHaveCount(0);
    // The panel's sliding pill stands (over the active page mode).
    await expect(a.locator('[data-slot="docblocks/doc-header-view-pill"]')).toBeVisible();
    await expect(a.locator('[data-doc-header-view-button="page"]')).toHaveAttribute("aria-pressed", "true");
    // Capture the doc's JSON (the switch is view state — it must not change it).
    const jsonBefore = await jsonOf(a, "a");
    // Switch to the canvas view: the editor's view changes (the page miniature stands).
    await a.getByRole("button", { name: "Canvas view" }).click();
    await expect(docArea.locator('[data-slot="docblocks/page-card"]')).toBeVisible();
    // The pill slides to the canvas mode (the active button flips).
    await expect(a.locator('[data-doc-header-view-button="canvas"]')).toHaveAttribute("aria-pressed", "true");
    // The switch is view state (no data write — the JSON is byte-identical).
    await expect.poll(() => jsonOf(a, "a"), SETTLE).toBe(jsonBefore);
  } finally {
    await close();
  }
});

test("the mode switcher's pill stands the soft-highlight token (the dark reads over the track's `muted`; the active icon stands the foreground)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-pill-token");
  try {
    // The pill's background = a standard soft-highlight token (NOT `background`
    // — the former stand was the dark theme's near-black, darker than the
    // track's `muted` and "gloomy"): the light stands the `accent` token, the
    // dark stands the `ring` token (the neutral theme's `accent` == `muted` —
    // the track — so the `accent`'s pill blends with the track; the `ring`
    // reads over it). The active icon = the `foreground` token (it reads over
    // the pill — the token's own contrast, not a blend). Each token's stand
    // stands the theme's resolve (the consumer's theme or the fallback
    // literal) — both themes are checked.
    const pillInfo = (expectedToken: string) =>
      a.evaluate((tok) => {
        const pill = document.querySelector('[data-slot="docblocks/doc-header-view-pill"]');
        if (pill === null) return null;
        const pillBg = getComputedStyle(pill).backgroundColor;
        // A probe element resolves a token's computed color (the same resolve the
        // pill's `bg-accent` / `dark:bg-ring` / the icon's `text-foreground`
        // run through) — the comparison is theme-agnostic (no token-string
        // normalization).
        const probe = (val: string): string => {
          const el = document.createElement("div");
          el.style.backgroundColor = val;
          el.style.position = "absolute";
          el.style.width = "0";
          el.style.height = "0";
          document.body.appendChild(el);
          const c = getComputedStyle(el).backgroundColor;
          el.remove();
          return c;
        };
        const expectedBg = probe(`var(${tok})`);
        const bgBg = probe("var(--background)");
        const mutedBg = probe("var(--muted)");
        const fgBg = probe("var(--foreground)");
        const activeBtn = document.querySelector('[data-slot="docblocks/doc-header-view"] [aria-pressed="true"]');
        return {
          pillBg,
          expectedBg,
          bgBg,
          mutedBg,
          activeColor: activeBtn !== null ? getComputedStyle(activeBtn).color : null,
          fgBg,
        };
      }, expectedToken);
    // The light's pill = the `accent`; the dark's pill = the `ring` (brighter
    // than the track's `muted` — the pill-blends-with-the-track guard,
    // the dark-only check). Both stand NOT the `background`.
    const themeTokens: [string, string][] = [
      ["light", "--accent"],
      ["dark", "--ring"],
    ];
    for (const [theme, token] of themeTokens) {
      await a.evaluate((t) => {
        if (t === "dark") document.documentElement.classList.add("dark");
        else document.documentElement.classList.remove("dark");
      }, theme);
      // Wait for the pill to stand the expected token (not the background / the
      // track) + the active icon to stand the foreground.
      await expect
        .poll(async () => {
          const info = await pillInfo(token);
          return (
            info !== null &&
            info.pillBg === info.expectedBg &&
            info.pillBg !== info.bgBg &&
            (theme === "light" || info.pillBg !== info.mutedBg) &&
            info.activeColor === info.fgBg
          );
        }, SETTLE)
        .toBe(true);
      const info = await pillInfo(token);
      expect(info?.pillBg).toBe(info?.expectedBg);
      expect(info?.pillBg).not.toBe(info?.bgBg);
      if (theme === "dark") expect(info?.pillBg).not.toBe(info?.mutedBg);
      expect(info?.activeColor).toBe(info?.fgBg);
    }
    // Regression: the switch still works (the pill slides over the
    // active mode — the component's shared style, the same pill, stands
    // the mermaid's selector too — the one class).
    await a.getByRole("button", { name: "Canvas view" }).click();
    await expect(a.locator('[data-doc-header-view-button="canvas"]')).toHaveAttribute("aria-pressed", "true");
  } finally {
    await close();
  }
});
