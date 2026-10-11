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

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
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

test("an embed inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed");

  await insertType(a, "a", "embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);

    // The plain iframe with the harness's fixed data: URL src...
    const iframe = doc.locator('iframe[data-slot="docblocks/embed"]');
    await expect(iframe, SETTLE).toHaveCount(1);
    expect((await iframe.getAttribute("src")) ?? "").toContain("data:text/html");
    // ...and the kind on the wrapper (v1: every kind renders as an iframe).
    await expect(doc.locator('[data-block-type="embed"][data-kind="iframe"]'), SETTLE).toHaveCount(1);
    // Not text-editable: the wrapper carries no inner editable.
    expect(await doc.locator('[data-block-type="embed"] [data-slot="docblocks/block-content"]').count()).toBe(0);
  }

  // The JSON inspector of pane A shows the embed attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "embed"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "iframe"');
  expect(jsonText).toContain("data:text/html");

  await close();
});

test("the catalog's embed renders in the motion pane (a non-text reorder target)", async ({ page }) => {
  const room = `ext01-motion-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&motion=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected", SETTLE);

  // The catalog embed is one of the root entries: it renders through the
  // motion view (no enter animation for entries present at mount) and is
  // not a drag source (no gutter handle on the wrapper).
  const embed = page.locator('[data-block-type="embed"]');
  await expect(embed).toHaveCount(1, SETTLE);
  await expect(embed).toHaveAttribute("data-kind", "iframe");
  await expect(embed.locator('[data-slot="docblocks/embed"]')).toBeVisible();
  expect(await embed.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
});
