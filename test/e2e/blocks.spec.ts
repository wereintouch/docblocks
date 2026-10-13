import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

async function twoPanes(
  browser: Browser,
  room: string
): Promise<{
  a: Page;
  b: Page;
  close: () => Promise<void>;
}> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

test("structurally inserted blocks render in the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03a-blocks");

  await insertType(a, "a", "code");
  await insertType(a, "a", "table");
  await insertType(a, "a", "divider");
  await insertType(a, "a", "image");

  const doc = b.locator('[data-testid="doc-b"]');

  // Code: a <pre> with the mono font family from the tokens.
  const pre = doc.locator('pre[data-block-type="code"]');
  await expect(pre, SETTLE).toHaveCount(1);
  await expect
    .poll(async () => pre.first().evaluate((el) => getComputedStyle(el).fontFamily), SETTLE)
    .toContain("mono");

  // Table: 2 rows x 2 cells; the cell border comes from the token (the
  // inlined standard seed is the harness default — the seeded border value).
  const cells = doc.locator("td[data-slot='docblocks/table-cell']");
  await expect(cells, SETTLE).toHaveCount(4);
  await expect(doc.locator("tr"), SETTLE).toHaveCount(2);
  await expect
    .poll(async () => cells.first().evaluate((el) => getComputedStyle(el).borderTopColor), SETTLE)
    .toBe("oklch(0.922 0 0)");

  // Divider and image (the src resolved from the harness's blob map).
  await expect(doc.locator('hr[data-slot="docblocks/divider"]'), SETTLE).toHaveCount(1);
  const img = doc.locator('img[data-slot="docblocks/image"]');
  await expect(img, SETTLE).toHaveCount(1);
  expect(await img.getAttribute("src")).toContain("data:image/svg+xml");
  await expect(img).toBeVisible();

  await close();
});
