// The image's figure + the embed's toolbar stand over the keyboard (the
// hover-reveal's complement — the focus-within's reveal + the keyboard's
// resize + the menu's / the zoom's actions). The programmatic focus's seeds
// stand on the component's spec's idiom (the code header's controls —
// code-block): the focus's reveal + the real keyboard's actions (the Enter's
// activate, the Tab's navigate, the arrows' resize). The text's content stands
// out (the Tab's gesture's contract — the focus's stands in the text).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

const FIXTURE = new URL("./fixtures/upload-test.png", import.meta.url).pathname;

/** The pane's image block's attrs from the harness global (its own letter). */
async function imageAttrs(page: Page, client: "a" | "b"): Promise<Record<string, unknown> | null> {
  return page.evaluate((c) => {
    const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
    if (doc === null || doc === undefined) return null;
    const json = doc.toJSON();
    const block = Object.values(json.blocks).find((entry) => entry.type === "image");
    return block?.attrs ?? null;
  }, client);
}

/** Pick the slash Image and deliver the fixture (the upload path). */
async function uploadFixture(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "Image" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE);
}

/** Insert an embed block over the slash Embed form (the committed attrs). */
async function insertEmbed(page: Page): Promise<void> {
  const inner = page.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await page.keyboard.type("/embed");
  const menuItem = page.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem, "the Embed command filters to one entry").toHaveCount(1, SETTLE);
  await page.keyboard.press("Enter");
  const form = page.locator("[data-slot='docblocks/slash-embed-form']");
  const urlInput = form.locator("[data-slot='docblocks/slash-embed-url']");
  await urlInput.fill("https://example.com/embedded");
  await form.locator("[data-slot='docblocks/slash-embed-kind']").selectOption("github");
  await form.locator("[data-slot='docblocks/slash-embed-insert']").click();
}

/** The element's computed opacity (the reveal's stand — "1" over the "0"). */
async function opacityOf(page: Page, locator: ReturnType<Page["locator"]>): Promise<string> {
  return locator.evaluate((el) => getComputedStyle(el).opacity);
}

test("the image's figure + menu stand over the keyboard (the focus's selection, the reveal, the resize, the caption)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "img-kbd");
  try {
    // Seed the image (the upload path, over the wire).
    const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await target.click();
    await a.keyboard.type("/image");
    await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible(SETTLE);
    await uploadFixture(a);
    const img = a.locator('img[data-slot="docblocks/image"]');
    await expect(img).toBeVisible(SETTLE);
    const figure = a.locator('[data-slot="docblocks/image-figure"]');
    const menu = a.locator('[data-slot="docblocks/image-menu"]');

    // At rest (no hover, no focus): the menu's opacity's "0" (the reveal's
    // absent).
    expect(await opacityOf(a, menu)).toBe("0");

    // The keyboard's focus seats the selection (the ports' stand) + stands the
    // menu's reveal (the focus-within's — the hover-only reveal kept the menu
    // invisible under the keyboard).
    await figure.focus();
    await expect(figure).toHaveAttribute("data-selected", "true", SETTLE);
    await expect(a.locator('[data-slot="docblocks/image-port"]')).toHaveCount(4, SETTLE);
    await expect.poll(async () => opacityOf(a, menu), SETTLE).toBe("1");

    // The keyboard's resize: the arrows' stand the width by a step (one
    // `updateBlock` per press — the doc's reaches B over the wire). The fresh
    // image's stands at the column's width (the max's), so the ne's port's (the
    // right's corner): the left's arrow's shrinks, the right's widens (below
    // the max's).
    const baseline = await img.evaluate((el) => el.getBoundingClientRect().width);
    const port = a.locator('[data-slot="docblocks/image-port"][data-corner="ne"]');
    await port.focus();
    await a.keyboard.press("ArrowLeft");
    const w1 = (await imageAttrs(a, "a"))!.width;
    expect(w1 as number).toBeLessThan(baseline);
    await a.keyboard.press("ArrowLeft");
    const w2 = (await imageAttrs(a, "a"))!.width;
    expect(w2 as number).toBeLessThanOrEqual(w1 as number);
    // The wire: pane B's doc carries the same width (the data only).
    await expect.poll(async () => (await imageAttrs(b, "b"))!.width, SETTLE).toBe(w2);
    // The widen's stand (the right's arrow's over the right's corner's, below
    // the max's): the width's increases.
    await a.keyboard.press("ArrowRight");
    const w3 = (await imageAttrs(a, "a"))!.width;
    expect(w3 as number).toBeGreaterThan(w2 as number);

    // The caption (the keyboard's Enter stands the line — the caret's seats
    // there — the commit travels over the wire).
    const captionToggle = menu.locator('[data-slot="docblocks/image-caption-toggle"]');
    await captionToggle.focus();
    await a.keyboard.press("Enter");
    const caption = a.locator('[data-slot="docblocks/image-caption"]');
    await expect(caption).toBeVisible(SETTLE);
    await a.keyboard.type("Fig Kbd");
    await expect.poll(async () => (await imageAttrs(a, "a"))!.caption, SETTLE).toBe("Fig Kbd");
    await expect.poll(async () => (await imageAttrs(b, "b"))!.caption, SETTLE).toBe("Fig Kbd");
  } finally {
    await close();
  }
});

test("the embed's toolbar stands over the keyboard (the focus's reveal, the zoom's in/out/reset)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "embed-kbd");
  try {
    // Seed the embed (the slash's form, over the wire).
    await insertEmbed(a);
    const wrapper = a.locator("[data-block-type='embed']");
    await expect(wrapper).toHaveCount(1, SETTLE);
    const toolbar = wrapper.locator('[data-slot="docblocks/embed-toolbar"]');
    const zoom = wrapper.locator('[data-slot="docblocks/embed-zoom"]');
    const zoomIn = toolbar.locator('[data-slot="docblocks/embed-zoom-in"]');
    const zoomOut = toolbar.locator('[data-slot="docblocks/embed-zoom-out"]');

    // The toolbar's reveal (the focus-within's stand): at rest the opacity's
    // "0" (the display:none's stand kept the controls out of the Tab's path);
    // the focus on a zoom control's stands the reveal.
    expect(await opacityOf(a, toolbar)).toBe("0");
    await zoomIn.focus();
    await expect.poll(async () => opacityOf(a, toolbar), SETTLE).toBe("1");

    // The zoom-in's (the Enter's activate, the view's state's): 100% → 120%.
    await a.keyboard.press("Enter");
    await expect(zoom).toHaveText("120%", SETTLE);

    // The Tab's navigation (the zoom-in's → the reset's over the zoom-out's,
    // the DOM's order's). The reset's Enter's stands the identity's.
    await a.keyboard.press("Tab");
    expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe(
      "docblocks/embed-zoom-reset"
    );
    await a.keyboard.press("Enter");
    await expect(zoom).toHaveText("100%", SETTLE);

    // The zoom-out's (the focus's seed, the Enter's activate): 100% → 83%.
    await zoomOut.focus();
    await a.keyboard.press("Enter");
    await expect(zoom).toHaveText("83%", SETTLE);

    // The zoom-in's back to the identity's: 83% → 100%.
    await zoomIn.focus();
    await a.keyboard.press("Enter");
    await expect(zoom).toHaveText("100%", SETTLE);

    // The view's state never reaches the doc (the data's stands invariant
    // over the pan/zoom's — the wire's and the JSON's stand).
    const attrs = await a.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed")!;
      return state.blocks[embedId]!.attrs;
    });
    expect(attrs).toEqual({ kind: "github", src: "https://example.com/embedded" });
  } finally {
    await close();
  }
});
