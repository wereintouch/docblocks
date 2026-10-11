import { type Browser, type Page, expect, test } from "@playwright/test";

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
  await page.getByTestId(`block-type-select-${client}`).selectOption(type);
  await page.getByTestId(`block-type-btn-${client}`).click();
}

/** The rendered block elements (every element carrying a data-block-id) of the pane. */
function blockElements(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-block-id]`);
}

/** Wait until both panes agree on the block count (the initial paragraphs synced). */
async function stableBlockCount(a: Page, b: Page): Promise<number> {
  await expect
    .poll(async () => {
      const [ca, cb] = [await blockElements(a, "a").count(), await blockElements(b, "b").count()];
      return ca === cb && ca > 0;
    }, SETTLE)
    .toBe(true);
  return blockElements(a, "a").count();
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

  // Table: 2 rows x 2 cells; the cell border comes from the token.
  const cells = doc.locator("td[data-slot='docblocks/table-cell']");
  await expect(cells, SETTLE).toHaveCount(4);
  await expect(doc.locator("tr"), SETTLE).toHaveCount(2);
  await expect
    .poll(async () => cells.first().evaluate((el) => getComputedStyle(el).borderTopColor), SETTLE)
    .toBe("rgba(175, 184, 193, 0.4)");

  // Divider and image (the src resolved from the harness's blob map).
  await expect(doc.locator('hr[data-slot="docblocks/divider"]'), SETTLE).toHaveCount(1);
  const img = doc.locator('img[data-slot="docblocks/image"]');
  await expect(img, SETTLE).toHaveCount(1);
  expect(await img.getAttribute("src")).toContain("data:image/svg+xml");
  await expect(img).toBeVisible();

  await close();
});

test("Enter does not split the block in either pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03a-enter");

  const before = await stableBlockCount(a, b);

  const p = a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').first();
  await p.click();
  await a.keyboard.type("ab");
  await a.keyboard.press("Enter");
  await a.keyboard.press("Shift+Enter");
  await a.waitForTimeout(300);

  // No block gained anywhere: the same count in both panes, the same text.
  expect(await blockElements(a, "a").count()).toBe(before);
  expect(await blockElements(b, "b").count()).toBe(before);
  await expect(p).toHaveText("ab");
  // The browser's default line split never ran: no <br>/<div> in the DOM.
  await expect(p.locator("br, div")).toHaveCount(0);

  await close();
});
