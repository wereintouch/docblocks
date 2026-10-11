import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string, motion = false): Promise<void> {
  const suffix = motion ? "&motion=1" : "";
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}${suffix}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

async function twoPanes(
  browser: Browser,
  room: string,
  motionA = false
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
  await openPane(a, "a", uniqueRoom, motionA);
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

test("an inserted block renders in the plain pane and settles in the motion pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-insert", true);

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);

  await a.getByTestId("block-btn-a").click();

  // The plain pane renders the block as it arrives...
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(3);
  // ...and the motion pane shows it once the enter animation settles
  // (the block is current after the insert, so it is labeled).
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(3);
  await expect
    .poll(
      async () => await currentWrapper(a, "a").evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      SETTLE
    )
    .toBe("1");
  await expect(currentWrapper(a, "a")).toBeVisible();

  await close();
});

test("a gutter deletion disappears in both panes (the exit animation completes)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-delete", true);

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");

  // The exit animation runs out (the leaving entry is popped out of the
  // layout) and the block is gone in both panes.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(before - 1);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});
