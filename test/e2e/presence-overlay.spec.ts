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

test("the remote caret renders inside the peer's block and clears on blur", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui02b-overlay");

  // A's real caret: click its (empty) paragraph and type. Clicking the
  // empty block also verifies the package stylesheet's ZWSP rule is live.
  const paragraphA = a.locator('[data-testid="doc-a"] [data-block-type="paragraph"]').first();
  await paragraphA.click();
  await a.keyboard.type("hello");
  const blockId = (await paragraphA.getAttribute("data-block-id")) ?? "";
  expect(blockId).not.toBe("");

  // B renders A's caret bar over the same block: the bar's center sits
  // inside the block's box (the bars are children of the editor root —
  // the positioning anchor — not of the blocks).
  await expect
    .poll(async () => {
      if ((await b.locator('[data-slot="docblocks/presence-caret"]').count()) !== 1) return false;
      const barBox = (await b.locator('[data-slot="docblocks/presence-caret"]').first().boundingBox()) ?? undefined;
      // The wrapper and the inner editable both carry the block id; the
      // geometry anchor is the block's wrapper.
      const blockBox =
        (await b.locator(`[data-block-id="${blockId}"]:not([data-slot="docblocks/block-content"])`).boundingBox()) ??
        undefined;
      if (barBox === undefined || blockBox === undefined) return false;
      const barCenterX = barBox.x + barBox.width / 2;
      const barCenterY = barBox.y + barBox.height / 2;
      return (
        barCenterX >= blockBox.x &&
        barCenterX <= blockBox.x + blockBox.width &&
        barCenterY >= blockBox.y &&
        barCenterY <= blockBox.y + blockBox.height
      );
    }, SETTLE)
    .toBe(true);

  // A blurs the editor (focus moves to the pane input, outside the editor
  // root) → the selection is published as null → B's caret goes away.
  await a.getByTestId("editor-a").click();
  await expect(b.locator('[data-slot="docblocks/presence-caret"]')).toHaveCount(0, SETTLE);

  await close();
});
