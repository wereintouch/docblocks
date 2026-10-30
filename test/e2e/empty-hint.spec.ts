import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY } from "./helpers";

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPane(browser: Browser, seed: string): Promise<{ a: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const a = await contextA.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  return {
    a,
    close: async () => {
      await contextA.close();
    },
  };
}

test("the empty block shows the command hint while the caret sits in it, and it hides once typed", async ({
  browser,
}) => {
  const { a, close } = await openPane(browser, "ux06-hint");
  // The pane seeds a single empty paragraph (the slash spec's seeded state).
  const innerEl = a.locator('[data-slot="docblocks/block-content"]').first();

  // While the caret sits in the empty block, the hint renders into the
  // content box as a ::before pseudo-element (no text content in the DOM,
  // nothing reaches the doc or the wire).
  await innerEl.click();
  const contentOf = () => innerEl.evaluate((el) => getComputedStyle(el, "::before").content);
  await expect.poll(contentOf).toBe("\"Type '/' for commands\"");

  // Typing makes the block non-empty: the hint goes away and the text stands
  // clean (the pseudo-element never entered the run text).
  await a.keyboard.type("hello");
  await expect.poll(contentOf).toBe("none");
  expect(await innerEl.textContent()).toBe("hello");

  await close();
});

test("the editor root carries the shared Card frame", async ({ browser }) => {
  const { a, close } = await openPane(browser, "ux06-card");
  const editor = a.locator('[data-slot="docblocks/editor"]');
  await expect(editor).toBeVisible();

  // The Card is the editor root's parent and carries the frame chrome
  // (a visible border and the card radius).
  const card = await editor.evaluate((el) => {
    const c = el.parentElement!;
    const s = getComputedStyle(c);
    return { slot: c.getAttribute("data-slot"), radius: parseFloat(s.borderRadius), border: s.borderTopWidth };
  });
  expect(card.slot).toBe("card");
  expect(card.radius).toBeGreaterThan(0);
  expect(card.border).toBe("1px");

  await close();
});
