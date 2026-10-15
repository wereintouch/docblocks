import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
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

  // The room starts with pane "a"'s single starter.
  await expect(inners(a, "a")).toHaveCount(1);
  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("one");
  await expect(inners(b, "b").first()).toHaveText("one");
  await insertBlockType(a, "a", "paragraph");
  await expect(inners(a, "a")).toHaveCount(2);

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
  await expect(b.locator(`[data-block-id="${id}"] strong`)).toHaveText("one");

  // The selection survived the store-driven change: a second mod+b over the
  // same range unsets the mark.
  await a.keyboard.press("Control+b");
  await expect(b.locator(`[data-block-id="${id}"] strong`)).toHaveCount(0);
  await expect(inners(b, "b").first()).toHaveText("one");

  await close();
});

test("Shift+Enter inserts a line break in the run text (synced, not a new block)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04-softbreak");

  // The store text of the first block (both panes seed the same room, so
  // the first non-root block is shared). The DOM carries a rendered-only
  // line anchor, so the store (not the raw textContent) is the assertion
  // target.
  const firstText = (page: Page, client: "a" | "b") =>
    page.evaluate((c) => {
      const d = window.__paneDocs?.[c];
      if (d === null || d === undefined) throw new Error(`the ${c} pane's doc is not mounted`);
      const firstId = d.getChildren(d.toJSON().id)[0]!;
      const block = d.getBlock(firstId);
      return (block?.content ?? []).map((r) => r.text).join("");
    }, client);

  const first = inners(a, "a").first();
  await first.click();
  await a.keyboard.type("line one");
  await a.keyboard.press("Shift+Enter");
  await a.keyboard.type("line two");

  // The break is a \n inside the run text of the same block: the block
  // count is unchanged (root + the single starter) and both panes carry the
  // break in the store text.
  await expect.poll(() => a.evaluate(() => Object.keys(window.__paneDocs!.a!.toJSON().blocks).length), SETTLE).toBe(2);
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one\nline two");
  await expect.poll(() => firstText(b, "b"), SETTLE).toBe("line one\nline two");

  // The break renders as a real line break: the inner is pre-wrap and
  // its box spans two text lines. The box read is polled: the DOM
  // rebuild after the last keystroke reflows asynchronously, and a
  // synchronous read right after the input can catch the pre-break box.
  let box: { whiteSpace: string; lines: number } | undefined;
  await expect
    .poll(async () => {
      box = await first.evaluate((el) => {
        const style = getComputedStyle(el);
        const line = parseFloat(style.lineHeight);
        return { whiteSpace: style.whiteSpace, lines: el.getBoundingClientRect().height / line };
      });
      return box.lines;
    })
    .toBeCloseTo(2, 1);
  expect(box!.whiteSpace).toBe("pre-wrap");

  // Backspace across the break: deleting "line two" (8 chars) keeps the
  // break; one more deletes the break and merges to the previous line.
  for (let i = 0; i < 8; i++) await a.keyboard.press("Backspace");
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one\n");
  await a.keyboard.press("Backspace");
  await expect.poll(() => firstText(a, "a"), SETTLE).toBe("line one");
  await expect.poll(() => firstText(b, "b"), SETTLE).toBe("line one");

  await close();
});
