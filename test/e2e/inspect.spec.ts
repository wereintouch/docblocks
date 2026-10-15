import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

/** Poll a pane element's innerText until it contains `text`. */
async function expectTextContains(page: Page, testid: string, text: string): Promise<void> {
  await expect.poll(async () => (await page.getByTestId(testid).innerText()).includes(text), SETTLE).toBe(true);
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

test("the json inspector and the wire log track the live doc", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "plg01-inspect");

  // A types into the pane's current block in the real editor.
  const current = a.locator('[data-testid^="block-a-"][data-current="true"]');
  await current.locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("live");

  // The local doc re-renders A's inspector; the remote update re-renders B's.
  await expectTextContains(a, "json-a", "live");
  await expectTextContains(b, "json-b", "live");

  // The wire log captures A's outgoing update and B's incoming one.
  await expect.poll(async () => /\] out \d+B/.test(await a.getByTestId("wire-a").innerText()), SETTLE).toBe(true);
  await expect.poll(async () => /\] in \d+B/.test(await b.getByTestId("wire-b").innerText()), SETTLE).toBe(true);

  await close();
});

test("the presence panel shows the remote selection", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "plg01-presence");

  const current = a.locator('[data-testid^="block-a-"][data-current="true"]');
  await current.locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("live");
  const testid = (await current.getAttribute("data-testid")) ?? "";
  const id = testid.slice("block-a-".length);
  expect(id).not.toBe("");

  // B shows the presence tab (a hidden panel's innerText collapses its
  // lines, so the line-shape assertions need the panel visible).
  await b.getByTestId("inspecttab-b-presence").click();

  // A's caret: the line keeps the <letter>:<blockId>:<offset> shape (the
  // same shape the keyboard spec asserts).
  await expect
    .poll(async () => (await b.getByTestId("presence-b").innerText()).includes(`a:${id}:4`), SETTLE)
    .toBe(true);

  // A one-character range: the anchor line alone cannot show a range, so
  // the panel adds the full selection as a compact JSON second line.
  await a.keyboard.press("Shift+ArrowLeft");
  await expect
    .poll(async () => {
      const lines = (await b.getByTestId("presence-b").innerText()).trim().split("\n");
      const first = lines[0];
      const second = lines[1];
      return first !== undefined && first.startsWith(`a:${id}:`) && second !== undefined && second.includes('"to"');
    })
    .toBe(true);

  await close();
});

test("the chaos bar drives the relay's frame chaos", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "plg01-chaos");

  // The delay mode is applied room-wide and shown in the bar.
  await a.getByTestId("chaos-delay").click();
  await expect(a.getByTestId("chaos-state")).toHaveText(/delay/);

  // Typing still converges under the delay (frames are deferred, not
  // dropped — no precise-timing assertion, the SETTLE window absorbs it).
  const current = a.locator('[data-testid^="block-a-"][data-current="true"]');
  await current.locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("slow");
  await expectTextContains(b, "doc-b", "slow");

  // The mode resets on the display and the wire comes back.
  await a.getByTestId("chaos-none").click();
  await expect(a.getByTestId("chaos-state")).toHaveText("none");

  await close();
});
