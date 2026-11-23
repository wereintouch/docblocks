// The document-attributes panel — the cover's preset's gallery (the
// 4-column's grid over the consumer's store's ids, the mode's sets' switch,
// the pick's commit over the mode, the alpha channel's stand, the toggle's
// off's stand) and the cover's frame's tint (the border's mix over the
// cover's average, the off's toggle, the consumer's glow over the hook's
// data).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the
// 15s SETTLE's panes + the page loads): the raised budget keeps the
// timeout class out of the loaded machine's flake zone (a true stall
// stays visible).
test.setTimeout(45_000);

/** The pane's `meta.attributes` record (null over the field's absent stand). */
async function attributesOf(page: Page, client: "a" | "b"): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return null;
      return doc.meta.attributes ?? null;
    },
    { client }
  );
}

const panel = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/attributes"]`);
const body = (page: Page, client: "a" | "b") => panel(page, client).locator('[data-slot="docblocks/attributes-body"]');
const toggle = (page: Page, client: "a" | "b") =>
  panel(page, client).locator('[data-slot="docblocks/attributes-toggle"]');

/** Expands the panel (the collapse state is the session's — the default: collapsed). */
async function openPanel(page: Page, client: "a" | "b"): Promise<void> {
  await toggle(page, client).click();
  await body(page, client).waitFor({ state: "visible" });
}

const coverBanner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/cover-banner"]`);
const editorRoot = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`);

test("the cover's preset's gallery: the 4-column's grid over the consumer's store's ids + the cross-pane's banner", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-presets");
  try {
    await openPanel(a, "a");
    const upload = panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]');
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');
    const grid = a.locator('[data-slot="docblocks/cover-preset-grid"]');
    const cells = a.locator('[data-slot="docblocks/cover-preset"]');

    // The modal's open (the harness's preset's gallery's stand — the
    // consumer's `coverPresets` prop's demo value over the fixed ids):
    // the tile's set (the 14's monochrome's + the alpha's swatch's count)
    // over the 4-column's grid.
    await upload.click();
    await expect(dialog).toBeVisible();
    await expect(grid).toBeVisible();
    await expect(cells).toHaveCount(15);
    const columns = await a
      .locator('[data-slot="docblocks/cover-preset-cells"]')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length);
    expect(columns, "the 4-column's stand").toBe(4);

    // The mode's switch's stand (the set's switch over the same grid's
    // stand — the 8's monochrome's + the alpha's centering's count, the
    // under-cap's row's stand), and back over the tile's set.
    await a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="center"]').click();
    await expect(cells).toHaveCount(9);
    await a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="tile"]').click();
    await expect(cells).toHaveCount(15);

    // A pick commits the id over the mode (the upload's no stand — the
    // consumer's catalog's curation's stand): the banner over the
    // resolved's swatch (the store's get's stand), and pane B's banner
    // stands the consumer's storage's parity (the fixed's id resolves
    // over pane B's own store's stand — the cross-pane's blob's stand is
    // the consumer's, and the harness's fixed ids stand it).
    await cells.first().click();
    await expect(dialog).toBeHidden();
    const cover = (await attributesOf(a, "a"))?.cover;
    expect(cover, "the pick commits the preset's id").toBe("cover-tile-1");
    expect((await attributesOf(a, "a"))?.coverMode, "the tile's stand is the key's absence").toBeUndefined();
    const banner = coverBanner(a, "a");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-cover-mode", "tile");
    const bannerBox = await banner.boundingBox();
    expect(Math.round(bannerBox!.height), "the fixed strip's height").toBe(150);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.cover ?? null), SETTLE).toBe(cover);
    await expect(coverBanner(b, "b")).toBeVisible();

    // The alpha channel's stand (the PNG's alpha layer: the banner's
    // wrapper + the background's layer stand no background of their own,
    // so the transparent's band composites over the card's surface — the
    // theme's stand). The alpha's swatch stands the set's tail.
    await upload.click();
    await expect(dialog).toBeVisible();
    await cells.last().click();
    await expect(dialog).toBeHidden();
    expect((await attributesOf(a, "a"))?.cover, "the alpha's pick commits the id").toBe("cover-alpha-1");
    const alphaBanner = coverBanner(a, "a");
    await expect(alphaBanner).toBeVisible();
    expect(
      await alphaBanner.evaluate((el) => getComputedStyle(el).backgroundColor),
      "the banner's wrapper stands no background of its own"
    ).toBe("rgba(0, 0, 0, 0)");
    const layer = alphaBanner.locator("div").first();
    expect(await layer.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
    expect(
      await layer.evaluate((el) => getComputedStyle(el).backgroundImage),
      "the alpha's png's resolution's stand over the store's get"
    ).toContain("url(");
    // The card's surface stands opaque behind the banner (the compositing's
    // stand) and flips over the theme's switch (the theme's dependency's
    // stand over the same banner's stand).
    const card = editorRoot(a, "a").locator("xpath=..");
    const cardDark = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardDark, "the card's surface stands opaque").not.toBe("rgba(0, 0, 0, 0)");
    await a.getByTestId("theme-a-light").click();
    const cardLight = await card.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(cardLight, "the theme's flip stands the card's surface's stand").not.toBe(cardDark);
    await expect(alphaBanner).toBeVisible();

    // The toggle's off's stand (the no-preset's layout's stand — the
    // grid's absence over the same modal's stand).
    await a.getByTestId("coverpresets-a-off").click();
    await upload.click();
    await expect(dialog).toBeVisible();
    await expect(grid).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the cover's frame's tint: the border's mix over the cover's average + the off's toggle + the consumer's glow", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-tint");
  try {
    await openPanel(a, "a");
    const upload = panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]');
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');
    const cells = a.locator('[data-slot="docblocks/cover-preset"]');

    // The solid swatch's cover (the first cell — the deterministic's
    // average's pin: the solid's fill stands its exact's rgb over the
    // canvas's decode).
    await upload.click();
    await expect(dialog).toBeVisible();
    await cells.first().click();
    await expect(dialog).toBeHidden();
    await expect(coverBanner(a, "a")).toBeVisible();

    const card = editorRoot(a, "a").locator("xpath=..");
    // The default's on: the data attribute + the average's variable over
    // the card's element (the border's element).
    await expect(card).toHaveAttribute("data-cover-tint");
    expect(await card.evaluate((el) => el.style.getPropertyValue("--docblocks-cover-tint-color"))).toBe(
      "rgb(14, 165, 233)"
    );
    const tinted = await card.evaluate((el) => getComputedStyle(el).borderColor);
    expect(tinted).not.toBe("rgba(0, 0, 0, 0)");

    // The window before the average color lands (the blob's read + the
    // image's decode): the attribute stands while the tint variable is
    // still absent — the border falls back to the plain border, never to
    // the text color (an undefined variable inside the mix would
    // invalidate the whole border-color and flash the dark theme's
    // near-white text color).
    const pending = await card.evaluate((el) => {
      // The computed colors land in different serializations (the mix's
      // srgb vs the token's oklch), so the stand is read off the alpha
      // (the border's translucent's stand) and the text-color's
      // difference (the invalid-var's flash resolves to `currentcolor`).
      const alphaOf = (value: string): number => {
        const match = /\/\s*([\d.]+)\s*\)$/.exec(value);
        return match === null ? 1 : Number(match[1]);
      };
      const textColor = getComputedStyle(el).color;
      el.style.removeProperty("--docblocks-cover-tint-color");
      const noTintColor = getComputedStyle(el).borderColor;
      const noTintAlpha = alphaOf(noTintColor);
      el.removeAttribute("data-cover-tint");
      const plainAlpha = alphaOf(getComputedStyle(el).borderColor);
      el.setAttribute("data-cover-tint", "");
      return { textColor, noTintColor, noTintAlpha, plainAlpha };
    });
    expect(pending.noTintColor, "the pending window never flashes the text color").not.toBe(pending.textColor);
    expect(pending.noTintAlpha, "the pending window's border keeps the border's translucent's stand").toBe(
      pending.plainAlpha
    );

    // The off's toggle (the panel's checkbox over the cover's presence):
    // the explicit's `false`'s write stands the attribute's removal and
    // the border's plain's stand.
    const tint = panel(a, "a").locator('[data-slot="docblocks/attributes-cover-tint"]');
    await expect(tint).toBeChecked();
    await tint.click();
    await expect(tint).not.toBeChecked();
    expect((await attributesOf(a, "a"))?.coverTint, "the off stands the explicit's false").toBe(false);
    await expect(card).not.toHaveAttribute("data-cover-tint");
    const plain = await card.evaluate((el) => getComputedStyle(el).borderColor);
    expect(plain, "the plain border's stand over the tint's removal").not.toBe(tinted);

    // The theme's flip's stand (the mix over the theme's border token):
    // the same cover stands the different's border over the light's theme.
    await tint.click();
    await expect(card).toHaveAttribute("data-cover-tint");
    await a.getByTestId("theme-a-light").click();
    const lightTinted = await card.evaluate((el) => getComputedStyle(el).borderColor);
    expect(lightTinted, "the theme's flip stands the mix's stand").not.toBe(tinted);

    // The consumer's glow's stand (the hook's data over the consumer's
    // chrome): the average's variable over the host's element — pane B's
    // parity over the consumer's storage's fixed's id (the cross-pane's
    // resolution's stand).
    const glowOf = (page: Page, client: "a" | "b"): Promise<string> =>
      page
        .locator(`[data-testid="doc-${client}"]`)
        .evaluate((el) => (el as HTMLElement).style.getPropertyValue("--cover-glow"));
    await expect.poll(glowOf.bind(null, a, "a"), SETTLE).toBe("rgb(14, 165, 233)");
    await expect.poll(glowOf.bind(null, b, "b"), SETTLE).toBe("rgb(14, 165, 233)");
  } finally {
    await close();
  }
});
