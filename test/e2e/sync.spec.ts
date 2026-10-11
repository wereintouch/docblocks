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

async function docText(page: Page, client: "a" | "b"): Promise<string> {
  return page.getByTestId(`doc-${client}`).innerText();
}

async function expectDocContains(page: Page, client: "a" | "b", text: string): Promise<void> {
  await expect.poll(async () => (await docText(page, client)).includes(text), SETTLE).toBe(true);
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

test("text syncs both directions", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "sync-text");

  await a.getByTestId("editor-a").pressSequentially("hello");
  await expectDocContains(b, "b", "hello");

  await b.getByTestId("editor-b").pressSequentially("world");
  await expectDocContains(a, "a", "helloworld");

  await close();
});

test("presence tracks the remote caret and its new block", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "sync-presence");

  await a.getByTestId("editor-a").pressSequentially("hello");
  // B shows A's caret as `a:<blockId>:<offset>` (bare block id, no testid prefix).
  const presenceLine = async () => (await b.getByTestId("presence-b").innerText()).trim();
  await expect.poll(presenceLine, SETTLE).toMatch(/^a:.+:\d+$/);

  // A adds a block; B's line follows the caret's move to the new block id.
  const current = a.locator('[data-testid^="block-a-"][data-current="true"]');
  const beforeId = ((await current.getAttribute("data-testid")) ?? "").slice("block-a-".length);
  await a.getByTestId("block-btn-a").click();
  // The line carries the bare block id (the testid prefix is not part of it).
  await expect
    .poll(async () => {
      const id = ((await current.getAttribute("data-testid")) ?? "").slice("block-a-".length);
      return id !== "" && id !== beforeId && new RegExp(`^a:${id}:\\d+$`).test(await presenceLine());
    }, SETTLE)
    .toBe(true);

  await close();
});

test("reconnect resyncs and stays live", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "sync-reconnect");

  await a.getByTestId("editor-a").pressSequentially("one");
  await expectDocContains(b, "b", "one");

  await b.getByTestId("reconnect-b").click();
  await expect(b.getByTestId("status-b")).toHaveText("connected", SETTLE);

  // The re-established socket is live for new updates...
  await a.getByTestId("editor-a").pressSequentially("two");
  await expectDocContains(b, "b", "two");
  // ...and the resynced state still carries the pre-reconnect edits.
  await expectDocContains(b, "b", "one");

  await close();
});
