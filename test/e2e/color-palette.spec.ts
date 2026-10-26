import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The shared color palette's e2e contract (the real browser resolves the
// theme tokens — jsdom cannot): the format palette popover and the shape
// toolbar's palette stand the eight circular swatches (the seven pastel
// tokens, then the theme's background),
// the swatch's computed background follows the theme (the pastel light
// value on light, the more muted dark value on dark — the dark flip), and
// the selected swatch stands the accent border (the theme's primary).

const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

// The palette's order: the seven pastel tokens, then the theme's
// background.
const PALETTE_ORDER = [
  "var(--docblocks-palette-red)",
  "var(--docblocks-palette-orange)",
  "var(--docblocks-palette-yellow)",
  "var(--docblocks-palette-green)",
  "var(--docblocks-palette-cyan)",
  "var(--docblocks-palette-blue)",
  "var(--docblocks-palette-violet)",
  "var(--background)",
] as const;

async function openPane(page: Page, room: string): Promise<void> {
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
}

async function openPage(browser: Browser): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openPane(page, `palette-${Math.random().toString(36).slice(2, 8)}`);
  return {
    page,
    close: async () => {
      await context.close();
    },
  };
}

async function setTheme(page: Page, dark: boolean): Promise<void> {
  await page.evaluate((value) => {
    document.documentElement.classList.toggle("dark", value);
  }, dark);
}

async function canvasCenter(page: Page): Promise<{ x: number; y: number }> {
  const view = page.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]');
  const box = (await view.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("the shape fill palette stands the eight swatches in order, theme-adaptive", async ({ browser }) => {
  const { page, close } = await openPage(browser);
  try {
    // The canvas view with a seeded, selected shape (the toolbar stands).
    await switchPaneView(page, "a", "canvas");
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) return;
      const surfaceId = doc.insertBlock("surface");
      doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
    });
    const center = await canvasCenter(page);
    await page.mouse.click(center.x, center.y);
    await expect(page.locator('[data-slot="docblocks/shape-toolbar"]')).toBeVisible();

    await page.getByLabel("Shape fill color").click();
    const palette = page.locator('[data-slot="docblocks/shape-fill-palette"]');
    await expect(palette).toBeVisible();
    const swatches = palette.locator('[data-slot="docblocks/palette-swatch"]');
    await expect(swatches).toHaveCount(8);
    // The order: the token's data-color sequence.
    expect(await swatches.evaluateAll((els) => els.map((el) => el.dataset.color))).toEqual(PALETTE_ORDER);

    // The circular swatches stand the theme token's background (computed).
    // The first swatch (red): the muted dark value (the harness stands
    // dark by default).
    const firstBg = (idx: number) => swatches.nth(idx).evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect.poll(async () => firstBg(0), SETTLE).toBe("rgb(201, 106, 106)");

    // The eighth swatch (the theme's background token — an `oklch(…)` color
    // the computed style serializes as itself) resolves to a concrete hex
    // through the canvas round-trip and commits on press. The harness stands
    // dark: the seed's dark background (`oklch(0.145 0 0)`) is `#0a0a0a`.
    await swatches.nth(7).click();
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const doc = window.__paneDocs?.a;
            if (doc === null || doc === undefined) return null;
            const json = doc.toJSON();
            const shape = Object.values(json.blocks).find((block) => block.type === "shape");
            return shape === undefined ? undefined : (shape.attrs?.fill as string | undefined);
          }),
        SETTLE
      )
      .toBe("#0a0a0a");
    await expect(page.locator('[data-slot="docblocks/shape"] g').first()).toHaveAttribute("fill", "#0a0a0a");

    // The dark flip: the same swatch stands the brighter light value on the
    // light theme (the token's adaptation, no data write).
    await setTheme(page, false);
    await expect.poll(async () => firstBg(0), SETTLE).toBe("rgb(247, 168, 168)");
    // The eighth swatch (the theme's background) stands the theme's
    // background token (resolved — not transparent).
    await expect(firstBg(7)).not.toBe("rgba(0, 0, 0, 0)");

    // The selected swatch stands the accent border (the theme's primary).
    // A click applies the fill (and marks the swatch selected). The
    // border's resolved stand polls (the store's commit + the re-resolve
    // are async).
    await swatches.nth(0).click();
    const primaryRgb = await page.evaluate(() => {
      const probe = document.createElement("span");
      probe.style.borderColor = "var(--primary)";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return color;
    });
    await expect
      .poll(async () => swatches.nth(0).evaluate((el) => getComputedStyle(el).borderTopColor), SETTLE)
      .toBe(primaryRgb);
  } finally {
    await close();
  }
});

test("the format palette popover stands the eight swatches in order", async ({ browser }) => {
  const { page, close } = await openPage(browser);
  try {
    // Type into the seeded paragraph and select the whole line (the
    // floating toolbar stands).
    const inner = page.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await inner.click();
    await page.keyboard.type("hello world");
    await page.keyboard.down("Shift");
    await page.keyboard.press("Home");
    await page.keyboard.up("Shift");

    const bar = page.locator('[data-testid="doc-a"] [data-slot="docblocks/format-toolbar"]');
    await expect(bar).toBeVisible();
    await bar.locator('[data-target="highlight"]').click();
    const palette = page.locator('[data-slot="docblocks/format-palette"]');
    await expect(palette).toBeVisible();
    const swatches = palette.locator('[data-slot="docblocks/palette-swatch"]');
    await expect(swatches).toHaveCount(8);
    expect(await swatches.evaluateAll((els) => els.map((el) => el.dataset.color))).toEqual(PALETTE_ORDER);
    // The dark default stand for the red token.
    await expect(await swatches.nth(0).evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      "rgb(201, 106, 106)"
    );
  } finally {
    await close();
  }
});
