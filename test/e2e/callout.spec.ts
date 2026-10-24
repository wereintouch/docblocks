import { type Browser, type Page, expect, test } from "@playwright/test";

// The callout's controls (the list-type menu's callout target): the type
// (preset) switch, the color override, and the icon override commit one
// updateBlock each (one undo step, one wire update) and reach the other
// pane; the preset switch resets the overrides. The icon grid stands the
// full catalog.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await openPane(a, "a", room);
  await openPane(b, "b", room);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** The pane's floating format toolbar. */
const toolbar = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/format-toolbar"]`);

/** Seed a callout (with a text run) in the pane; returns the block id. */
async function seedCallout(page: Page, client: "a" | "b", attrs: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    ({ client, attrs }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("callout", attrs);
      doc.insertText(id, 0, "note");
      return id;
    },
    { client, attrs }
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
  const coId = await seedCallout(a, "a", { variant: "info", color: "#ff0000", icon: "star" });
  await expect.poll(async () => (await calloutAttrs(a, "a", coId))?.variant, SETTLE).toBe("info");

  await selectCalloutText(a, "a", coId);
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();
  // The callout target stands the callout menu, not the list-type radio menu.
  await expect(bar.locator('button[aria-label="Callout"]')).toBeVisible();
  await expect(bar.locator('button[aria-label="List type"]')).toHaveCount(0);

  // Open the menu (a click — the radix Popover trigger) and pick the preset.
  await bar.locator('button[aria-label="Callout"]').click();
  const menu = a.locator('[data-slot="docblocks/format-callout-menu"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-callout-type-btn="danger"]').click();

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
  const coId = await seedCallout(a, "a", { variant: "warning" });
  await selectCalloutText(a, "a", coId);
  const bar = toolbar(a, "a");
  await bar.locator('button[aria-label="Callout"]').click();
  const menu = a.locator('[data-slot="docblocks/format-callout-menu"]');
  await expect(menu).toBeVisible();
  await menu.locator('[data-callout-icon-btn="star"]').click();

  const aAttrs = await calloutAttrs(a, "a", coId);
  expect(aAttrs).toMatchObject({ variant: "warning", icon: "star" });
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.icon, SETTLE).toBe("star");
  // The variant stood (the preset identity is kept).
  expect((await calloutAttrs(b, "b", coId))?.variant).toBe("warning");
  await close();
});

test("the color override applies a hex and clears with the none swatch", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "callout-color");
  const coId = await seedCallout(a, "a", {});
  await selectCalloutText(a, "a", coId);
  const bar = toolbar(a, "a");
  await bar.locator('button[aria-label="Callout"]').click();
  const menu = a.locator('[data-slot="docblocks/format-callout-menu"]');
  await expect(menu).toBeVisible();

  // The first swatch is a theme token; the commit resolves it to a hex.
  await menu.locator('[data-color="var(--docblocks-palette-red)"]').click();
  const aColor = (await calloutAttrs(a, "a", coId))?.color;
  expect(aColor).toMatch(/^#[0-9a-f]{6}$/i);
  // The other pane stands the same hex.
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toMatch(/^#[0-9a-f]{6}$/i);

  // Clear with the none swatch (the preset per variant).
  await menu.locator('[data-slot="docblocks/palette-none"]').click();
  expect((await calloutAttrs(a, "a", coId))?.color ?? null).toBe(null);
  await expect.poll(async () => (await calloutAttrs(b, "b", coId))?.color, SETTLE).toBe(null);
  await close();
});

test("the icon grid stands the full catalog", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "callout-grid");
  const coId = await seedCallout(a, "a", {});
  await selectCalloutText(a, "a", coId);
  const bar = toolbar(a, "a");
  await bar.locator('button[aria-label="Callout"]').click();
  const menu = a.locator('[data-slot="docblocks/format-callout-menu"]');
  await expect(menu).toBeVisible();
  // One button per catalog icon (18) + the preset entry.
  await expect(menu.locator("[data-callout-icon-btn]")).toHaveCount(18);
  await expect(menu.locator("[data-callout-icon-preset]")).toHaveCount(1);
  await close();
});
