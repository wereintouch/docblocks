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

/**
 * Seed the clipboard with the rich content a default copy of the block
 * would carry (its innerHTML as text/html plus the plain text). Headless
 * Chromium does not write the system clipboard from a keyboard copy, so
 * the copy side is simulated; the paste side uses the real clipboard.
 */
async function copyBlockToClipboard(page: Page, client: "a" | "b"): Promise<void> {
  await page.evaluate(async (client) => {
    const inner = document.querySelector<HTMLElement>(
      `[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`
    );
    if (inner === null) throw new Error("the pane should have a block");
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([`<html><body>${inner.innerHTML}</body></html>`], { type: "text/html" }),
        "text/plain": new Blob([inner.textContent ?? ""], { type: "text/plain" }),
      }),
    ]);
  }, client);
}

/**
 * Paste the OS clipboard into the focused element: the real clipboard
 * payload is read back and dispatched as a paste event (headless Chromium
 * does not synthesize a paste event from Control+v).
 */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const textOf = async (items: readonly ClipboardItem[], type: string): Promise<string | null> => {
      for (const item of items) {
        if (item.types.includes(type)) return (await item.getType(type)).text();
      }
      return null;
    };
    const items = await navigator.clipboard.read();
    const html = await textOf(items, "text/html");
    const plain = await textOf(items, "text/plain");
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    if (html !== null) transfer.setData("text/html", html);
    if (plain !== null) transfer.setData("text/plain", plain);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  });
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
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"]);
  await contextB.grantPermissions(["clipboard-read", "clipboard-write"]);
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

test("a rich paste carries the clipboard marks into both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-clipboard");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(inners(a, "a"), SETTLE).toHaveCount(2);
  const firstA = inners(a, "a").first();
  const firstId = (await firstA.getAttribute("data-block-id")) ?? "";
  expect(firstId).not.toBe("");

  // A types the word and blurs; B bolds the range, so the mark change
  // reaches A as a remote update while A's selection is outside — A's text
  // DOM re-syncs from the store and shows the <strong> (a mark-only change
  // does not rebuild while the selection is inside the block).
  await firstA.click();
  await a.keyboard.type("hello");
  await expect(inners(b, "b").first(), SETTLE).toHaveText("hello");
  await a.getByTestId("status-a").click();

  const firstB = inners(b, "b").first();
  await firstB.click();
  await b.keyboard.press("End");
  await selectLeft(b, 5);
  await b.keyboard.press("Control+b");
  await expect(firstA.locator("strong"), SETTLE).toHaveText("hello");

  // Copy the bold word to the clipboard (what a default copy would carry),
  // then paste it into the second (empty) block.
  await copyBlockToClipboard(a, "a");
  const secondA = inners(a, "a").nth(1);
  await secondA.click();
  await pasteFromClipboard(a);

  // The runs arrive with the mark: one marked run only, no raw HTML nodes
  // or attribute soup in the DOM.
  await expect.poll(async () => await secondA.innerHTML(), SETTLE).toBe("<strong>hello</strong>");

  // The other pane converges to the same marked run.
  const secondB = inners(b, "b").nth(1);
  await expect.poll(async () => await secondB.innerHTML(), SETTLE).toBe("<strong>hello</strong>");
  await expect(secondB).toHaveText("hello", SETTLE);

  await close();
});
