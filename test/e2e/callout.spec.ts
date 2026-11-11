// The callout's controls (the block menu over the clickable marker-zone
// icon): the type (preset) switch, the color override (the swatches + the
// custom's picker), and the icon override commit one updateBlock each
// (one undo step, one wire update) and reach the other pane; the preset
// switch resets the overrides. The menu stands for an empty callout (no
// text selection needed). The toolbar over the callout's text stands the
// shared marks + the alignment only (the callout's section stands the
// block's menu). The view's mode renders the icon without a button.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane, twoPanes } from "./helpers";

/** The pane's floating format toolbar. */
const toolbar = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/format-toolbar"]`);

/** The pane's callout's icon button (the block menu's trigger). */
const iconButton = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/callout-icon-button"]`);

/** The portaled block menu (the document's body's stand). */
const menu = (page: Page) => page.locator('[data-slot="docblocks/callout-menu"]');

/** Seed a callout (with a text run) in the pane; returns the block id. */
async function seedCallout(
  page: Page,
  client: "a" | "b",
  attrs: Record<string, unknown>,
  text?: string
): Promise<string> {
  return page.evaluate(
    ({ client, attrs, text }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("callout", attrs);
      if (text !== undefined) doc.insertText(id, 0, text);
      return id;
    },
    { client, attrs, text }
  );
}

/** The callout block's attrs as read in the pane (undefined while absent). */
async function calloutAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ variant?: string; color?: string | null; icon?: string | null } | undefined> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return undefined;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "callout") return undefined;
      return block.attrs as { variant?: string; color?: string | null; icon?: string | null };
    },
    { client, id }
  );
}

/** Select the callout's text (raises the toolbar). */
async function selectCalloutText(page: Page, client: "a" | "b", id: string): Promise<void> {
  const inner = page.locator(
    `[data-testid="doc-${client}"] [data-block-id="${id}"][data-slot="docblocks/block-content"]`
  );
  await inner.click();
  await page.keyboard.press("End");
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

test("the type switch reaches the other pane (the preset resets the overrides)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-type");
  const coId = await seedCallout(a, "a", { variant: "info", color: "#ff0000", icon: "star" }, "note");
  await expect.poll(async () => (await calloutAttrs(a, "a", coId))?.variant, SETTLE).toBe("info");

  // Open the block's menu over the icon (no text selection needed).
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  // The callout target stands the block's menu, not the toolbar's section.
  await expect(a.locator('[data-slot="docblocks/format-toolbar"] [data-callout-type-btn]')).toHaveCount(0);
  await menu(a).locator('[data-callout-type-btn="danger"]').click();

  const aAttrs = await calloutAttrs(a, "a", coId);
  expect(aAttrs).toMatchObject({ variant: "danger", color: null, icon: null });
  // The other pane stands the switch (the overrides reset with the preset).
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.variant, SETTLE).toBe("danger");
  const bAttrs = await calloutAttrs(b, "b", coId);
  expect(bAttrs).toMatchObject({ color: null, icon: null });
  await close();
});

test("the icon override reaches the other pane (the variant stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-icon");
  const coId = await seedCallout(a, "a", { variant: "warning" }, "note");
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  await menu(a).locator('[data-callout-icon-btn="star"]').click();

  const aAttrs = await calloutAttrs(a, "a", coId);
  expect(aAttrs).toMatchObject({ variant: "warning", icon: "star" });
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.icon, SETTLE).toBe("star");
  // The variant stood (the preset identity is kept).
  expect((await calloutAttrs(b, "b", coId))?.variant).toBe("warning");
  await close();
});

test("the color override applies a hex and clears with the none swatch", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-color");
  const coId = await seedCallout(a, "a", {}, "note");
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();

  // The first swatch is a theme token; the commit resolves it to a hex (the
  // pick's stand closes the menu — the next action reopens it).
  await menu(a).locator('[data-color="var(--docblocks-palette-red)"]').click();
  const aColor = (await calloutAttrs(a, "a", coId))?.color;
  expect(aColor).toMatch(/^#[0-9a-f]{6}$/i);
  // The other pane stands the same hex.
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toMatch(/^#[0-9a-f]{6}$/i);

  // Clear with the none swatch (the preset per variant): reopen the menu
  // (the pick's close stands) and pick the none.
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  await menu(a).locator('[data-slot="docblocks/palette-none"]').click();
  expect((await calloutAttrs(a, "a", coId))?.color ?? null).toBe(null);
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toBe(null);
  await close();
});

test("the icon grid stands the full catalog", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "callout-grid");
  await seedCallout(a, "a", {}, "note");
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  // One button per catalog icon (18); the former's "Preset"'s row stands no
  // stand (the type preset resets the icon's override).
  await expect(menu(a).locator("[data-callout-icon-btn]")).toHaveCount(18);
  await expect(menu(a).locator("[data-callout-icon-preset]")).toHaveCount(0);
  await close();
});

test("the menu stands for an empty callout (no text selection)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-empty");
  const coId = await seedCallout(a, "a", { variant: "info" });
  await expect.poll(async () => (await calloutAttrs(a, "a", coId))?.variant, SETTLE).toBe("info");

  // No text, no selection: the icon's press opens the menu (the block's
  // attrs' management needs no selection).
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  await menu(a).locator('[data-callout-type-btn="danger"]').click();
  expect((await calloutAttrs(a, "a", coId))?.variant).toBe("danger");
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.variant, SETTLE).toBe("danger");
  await close();
});

test("the custom color's hex commits over the field's Enter (the wire's stand)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-custom-color");
  const coId = await seedCallout(a, "a", { variant: "info" }, "note");

  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  // The custom swatch's press: the picker's section stands over the menu's
  // background row (the menu's stand).
  await menu(a).locator('[data-slot="docblocks/palette-custom"]').click();
  const field = menu(a).locator('[data-slot="docblocks/callout-color-picker"] input[aria-label="Hex color value"]');
  await expect(field).toBeVisible();
  await field.fill("#1a2b3c");
  await field.press("Enter");

  expect((await calloutAttrs(a, "a", coId))?.color).toBe("#1a2b3c");
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toBe("#1a2b3c");
  // The apply stands the menu's close.
  await expect(menu(a)).toHaveCount(0);
  await close();
});

test("the custom color's scrub commits over the close (the grid shows the new current)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-scrub-commit");
  const coId = await seedCallout(a, "a", { variant: "info" }, "note");

  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  await menu(a).locator('[data-slot="docblocks/palette-custom"]').click();
  const native = menu(a).locator('[data-slot="docblocks/callout-color-picker"] input[type="color"]');
  await expect(native).toBeVisible();

  // The wheel's scrub fires the `input` only (the live draft; the dialog's
  // `change` does not fire for the close): no doc write over the scrub.
  await native.evaluate((el: HTMLInputElement) => {
    el.value = "#ff5500";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect((await calloutAttrs(a, "a", coId))?.color ?? null).toBe(null);

  // The close without a commit (the Esc) applies the scrubbed value (the
  // picker's unmount commits it; the exit animation delays the unmount,
  // so the read waits for a settle).
  await a.keyboard.press("Escape");
  await expect.poll(async () => (await calloutAttrs(a, "a", coId))?.color, SETTLE).toBe("#ff5500");
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toBe("#ff5500");

  // The grid: the reopened menu's custom swatch carries the non-preset
  // value (the dot).
  await iconButton(a, "a").click();
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[data-slot="docblocks/palette-custom-current"]')).toBeVisible();
  await close();
});

test("the toolbar over the callout's text stands no callout section", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "callout-toolbar");
  const coId = await seedCallout(a, "a", {}, "note");
  await selectCalloutText(a, "a", coId);
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();
  // The shared marks + the alignment stand; the callout's trigger (the
  // former's menu's entry) and the list-type menu are both absent.
  await expect(bar.locator('button[data-mark="bold"]')).toBeVisible();
  await expect(bar.locator('button[aria-label="Callout"]')).toHaveCount(0);
  await expect(bar.locator('button[aria-label="List type"]')).toHaveCount(0);
  // The block's menu stands the icon's button (the text's selection's stand).
  await expect(iconButton(a, "a")).toBeVisible();
  await close();
});

test("the view's mode stands the icon without a button (no pointer events)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  // The per-run room's suffix (the twoPanes' parity): the spec re-runs
  // accumulate a callout over the fixed room's name (the relay's rooms
  // persist over the dev server's lifetime) and the button's locator
  // stands strict over several blocks.
  await openPane(page, "a", `callout-readonly-${Math.random().toString(36).slice(2, 8)}`);
  const coId = await page.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const id = doc.insertBlock("callout", { variant: "warning", icon: "star" });
    doc.insertText(id, 0, "note");
    return id;
  });
  try {
    await expect(iconButton(page, "a")).toBeVisible();
    // The mode's switcher (the DocHeader's stand): the view's mode.
    await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
    await expect(page.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
    // The read-only's stand: the icon's zone stands (the stand's render),
    // the button (the pointer events' stand) is absent.
    await expect(page.locator(`[data-block-id="${coId}"] [data-slot="docblocks/callout-icon"]`)).toBeVisible();
    await expect(iconButton(page, "a")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
