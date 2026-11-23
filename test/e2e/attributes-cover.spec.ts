// The document-attributes panel — the cover's upload modal: the gate over
// the mode (the short / the narrow's rejection over the measured threshold),
// the banner over the top (the full frame width's bleed, the frame's
// corner's clip, the mode's row's switch), and the unsupported type's
// rejection (the MIME's gate). The canvas view never renders the banner (the
// page view's stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, switchPaneView, twoPanes } from "./helpers";

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

// The cover's upload's fixtures: the 1x1 pixel (the short / the narrow's
// gate's rejection), the 400x200 solid (the tile's accepted cover — the
// narrow strip's glue's stand), the 1600x400 solid (the wide cover — the
// editor width's minimum's stand over the 1280px's viewport), the
// 1600x100 solid (the centering's short cover — the scaled height's
// under-cap's stand), and the 1x1 GIF (the unsupported type's rejection).
const SHORT_PNG = new URL("./fixtures/upload-test.png", import.meta.url).pathname;
const TALL_PNG = new URL("./fixtures/cover-400x200.png", import.meta.url).pathname;
const WIDE_PNG = new URL("./fixtures/cover-1600x400.png", import.meta.url).pathname;
const SHORT_WIDE_PNG = new URL("./fixtures/cover-1600x100.png", import.meta.url).pathname;
const GIF = new URL("./fixtures/cover-1x1.gif", import.meta.url).pathname;
const coverBanner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/cover-banner"]`);
const editorRoot = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`);

/** The upload's modal's flow: the drop zone's click + the file's choice
 *  over the standard picker (the filechooser's stand). */
async function pickInModal(page: Page, file: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/cover-upload-dropzone"]').click();
  await (await chooser).setFiles(file);
}

test("the cover's upload modal: the gate over the mode, the banner over the top, the mode's row", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-modal");
  try {
    await openPanel(a, "a");
    const upload = panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]');
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');

    // The modal's open (the selector's stand, the tile's default).
    await upload.click();
    await expect(dialog).toBeVisible();
    await expect(a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="tile"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // The short image over the tile (the height gate's rejection): the
    // upload never reaches the store, the doc stands the no write, the
    // hint's stand shows the threshold, and the modal keeps open.
    await pickInModal(a, SHORT_PNG);
    const hint = a.locator('[data-slot="docblocks/cover-upload-error"]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/150/);
    expect((await attributesOf(a, "a"))?.cover, "the rejection stands the no write").toBeUndefined();
    await expect(dialog).toBeVisible();

    // The tall image over the tile's default — the acceptance's stand:
    // the modal's close, the cover's commit (the mode's absence — the
    // tile's stand), the banner's render over the editor frame's top
    // edge (the full frame width's bleed, the frame's corner's clip),
    // and the sync to pane B over the wire.
    await pickInModal(a, TALL_PNG);
    await expect(dialog).toBeHidden();
    const cover = (await attributesOf(a, "a"))?.cover;
    expect(cover, "the accepted image commits the cover").toBeTruthy();
    expect((await attributesOf(a, "a"))?.coverMode, "the tile's stand is the key's absence").toBeUndefined();
    const banner = coverBanner(a, "a");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-cover-mode", "tile");
    // The frame's edge's stand: the banner stands the editor frame's full
    // width (not the page column's centered stand), and the frame's top
    // corner stands the card's radius's clip.
    const bannerBox = await banner.boundingBox();
    const editorBox = await editorRoot(a, "a").boundingBox();
    expect(bannerBox, "the banner should stand").not.toBeNull();
    expect(editorBox, "the editor should stand").not.toBeNull();
    expect(Math.abs(bannerBox!.width - editorBox!.width), "the full frame width's bleed").toBeLessThan(2);
    // The fixed's strip's height's stand (the image's 200px's natural
    // height scaled down to the 150px's constant).
    expect(Math.round(bannerBox!.height), "the fixed strip's height").toBe(150);
    // The frame's corner's clip: the banner's top radius stands the
    // card's radius (the card's computed stand — no magic number's
    // stand over the scale's change).
    const cardRadius = await editorRoot(a, "a").evaluate(
      (el) => getComputedStyle(el.parentElement as HTMLElement).borderTopLeftRadius
    );
    await expect(banner).toHaveCSS("border-top-left-radius", cardRadius);
    // The narrow strip's stand (the 400px's fixture over the frame's
    // width): the repeat-x's glue.
    await expect(banner.locator("div").first()).toHaveCSS("background-repeat", "repeat-x");
    // The banner stands above the attributes panel (the top's placement).
    const panelBox = await panel(a, "a").boundingBox();
    expect(panelBox, "the panel should stand").not.toBeNull();
    expect(bannerBox!.y, "the banner stands above the panel").toBeLessThan(panelBox!.y);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.cover ?? null), SETTLE).toBe(cover);
    // The banner's render over pane B stands the blob store's stand (the
    // harness's store is per-context — the cross-pane's blob's stand is
    // the consumer's, not the package's), so pane B's pin is the
    // attribute's sync only.

    // The mode's switch's gate (the narrow strip's stand): the centering's
    // option stands disabled over the current image (the width's gate's
    // unmet stand). The wide's re-upload stands the gate's met's stand —
    // the option's enabled stand over the same row.
    const centerOption = a.locator('[data-slot="docblocks/attributes-cover-mode"] [data-mode="center"]');
    await expect(centerOption).toBeDisabled();
    await upload.click();
    await expect(dialog).toBeVisible();
    await pickInModal(a, WIDE_PNG);
    await expect(dialog).toBeHidden();
    await expect(centerOption).toBeEnabled();

    // The mode's row's switch (the panel's toggle over the gate's met
    // stand): the centering's commit (the key's write) + the banner's
    // re-stand (the width scaled to the frame, the 150px's slice over the
    // scaled height's cap) — synced to pane B.
    await centerOption.click();
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");
    await expect(banner).toHaveAttribute("data-cover-mode", "center");
    // The 1600x400's fixture scaled to the frame's width: the scaled
    // height exceeds the cap at the harness's width — the slice stands
    // the maximum.
    const centerBox = await banner.boundingBox();
    expect(centerBox, "the centering's banner should stand").not.toBeNull();
    expect(Math.round(centerBox!.height), "the centered slice's cap").toBe(150);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");

    // The canvas view never renders the banner (the page view's stand).
    await switchPaneView(a, "a", "canvas");
    await expect(coverBanner(a, "a")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the cover's upload modal: the centering's width gate + the unsupported type's rejection", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-center");
  try {
    await openPanel(a, "a");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]').click();
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');

    // The centering's mode (the modal's selector): the editor width's
    // minimum's gate over the image's width.
    await a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="center"]').click();

    // The narrow image (the 400px's fixture over the editor frame's
    // width) — the width gate's rejection: the no upload's no write, the
    // hint's stand over the measured width.
    await pickInModal(a, TALL_PNG);
    const hint = a.locator('[data-slot="docblocks/cover-upload-error"]');
    await expect(hint).toBeVisible();
    expect((await attributesOf(a, "a"))?.cover, "the rejection stands the no write").toBeUndefined();
    await expect(dialog).toBeVisible();

    // The GIF — the MIME's gate's rejection (the decode's no probe).
    await pickInModal(a, GIF);
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveText(/150/);
    expect((await attributesOf(a, "a"))?.cover, "the unsupported type stands the no write").toBeUndefined();

    // The wide image — the acceptance's stand over the centering: the
    // cover + the mode's commit (the key's write), the banner's
    // centering's stand (the scaled height's cap), and the sync to pane B.
    await pickInModal(a, WIDE_PNG);
    await expect(dialog).toBeHidden();
    const cover = (await attributesOf(a, "a"))?.cover;
    expect(cover, "the accepted image commits the cover").toBeTruthy();
    expect((await attributesOf(a, "a"))?.coverMode, "the centering commits the key").toBe("center");
    const banner = coverBanner(a, "a");
    await expect(banner).toHaveAttribute("data-cover-mode", "center");
    // The sliced height over the scaled width (the cap's stand at the
    // harness's frame's width).
    const frameWidth = (await editorRoot(a, "a").boundingBox())!.width;
    const wideBox = await banner.boundingBox();
    expect(Math.round(wideBox!.height), "the capped slice's height").toBe(
      Math.round(Math.min(150, (400 * frameWidth) / 1600))
    );
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");

    // The short wide image — the scaled height's under-cap's stand: the
    // slice stands the scaled height's own (under the 150px's cap).
    await panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]').click();
    await expect(dialog).toBeVisible();
    await pickInModal(a, SHORT_WIDE_PNG);
    await expect(dialog).toBeHidden();
    const shortBox = await banner.boundingBox();
    expect(Math.round(shortBox!.height), "the under-cap slice's height").toBe(
      Math.round(Math.min(150, (100 * frameWidth) / 1600))
    );
  } finally {
    await close();
  }
});
