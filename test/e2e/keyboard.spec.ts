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

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`);
}

/** Press Shift+ArrowLeft n times, one by one (discrete presses coalesce otherwise). */
async function selectLeft(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i++) await page.keyboard.press("Shift+ArrowLeft");
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

test("ArrowDown at the text end moves the caret to the next block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-arrow");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(inners(a, "a"), SETTLE).toHaveCount(2);
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("one");
  await expect(inners(b, "b").first(), SETTLE).toHaveText("one");

  // Caret to the end, ArrowDown: the caret moves to the start of the next
  // (empty) block — B's presence line shows it at offset 0.
  await a.keyboard.press("End");
  await a.keyboard.press("ArrowDown");
  const nextId = await inners(a, "a").nth(1).getAttribute("data-block-id");
  expect(nextId).not.toBe(null);
  await expect.poll(() => b.getByTestId("presence-b").innerText(), SETTLE).toContain(`a:${nextId}:0`);

  await close();
});

test("mod+b toggles the selected range bold in the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-bold");

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("one");
  const id = (await first.getAttribute("data-block-id")) ?? "";
  expect(id).not.toBe("");

  // Select "one" (End + 3x Shift+ArrowLeft) and bold it (Control for a
  // platform-stable hotkey). The assertions read pane B's DOM (the local
  // pane does not re-render mark-only changes while the selection is
  // inside the block).
  await a.keyboard.press("End");
  await selectLeft(a, 3);
  await a.keyboard.press("Control+b");
  await expect(b.locator(`[data-block-id="${id}"] strong`), SETTLE).toHaveText("one");

  // The selection survived the store-driven change: a second mod+b over the
  // same range unsets the mark.
  await a.keyboard.press("Control+b");
  await expect(b.locator(`[data-block-id="${id}"] strong`)).toHaveCount(0, SETTLE);
  await expect(inners(b, "b").first(), SETTLE).toHaveText("one");

  await close();
});
