import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

/** The top-level editor of a pane (the non-catalog panes hold one editor). */
function editorOf(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`).first();
}

/** Type the `@` phrase and pick the user — the chip stands (the shared
 *  setup of the interactions' tests). */
async function standChip(a: Page, client: "a" | "b", blockId: string): Promise<void> {
  const inner = a.locator(
    `[data-testid="doc-${client}"] [data-block-id="${blockId}"][data-slot="docblocks/block-content"]`
  );
  await inner.click();
  await a.keyboard.type("@Ada");
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.getByText("Ada Lovelace").isVisible(), SETTLE).toBe(true);
  await picker.getByText("Ada Lovelace").click();
}

test("the hover card stands the consumer's card (the open's delay, the exit's close)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-card-hover");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await standChip(a, "a", blockId);
  const chip = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);

  // The hover: the card stands over the open's delay (the consumer's demo
  // content over the package's host — the host carries the target's attrs
  // and the viewport's fixed anchor).
  await chip.hover();
  const card = a.locator('[data-slot="docblocks/mention-card"]');
  await expect.poll(async () => card.isVisible(), SETTLE).toBe(true);
  await expect(card).toHaveAttribute("data-mention-kind", "user");
  await expect(card).toHaveAttribute("data-mention-id", "u1");
  await expect(card).toHaveAttribute("aria-hidden", "true");
  await expect(card).toHaveText(/Ada Lovelace/);

  const stand = await a.evaluate(() => {
    const cardEl = document.querySelector<HTMLElement>('[data-slot="docblocks/mention-card"]');
    const chipEl = document.querySelector<HTMLElement>('[data-slot="docblocks/mention"]');
    if (cardEl === null || chipEl === null) return null;
    const c = cardEl.getBoundingClientRect();
    const ch = chipEl.getBoundingClientRect();
    return {
      position: window.getComputedStyle(cardEl).position,
      above: c.bottom <= ch.top - 4,
      below: c.top >= ch.bottom + 4,
    };
  });
  expect(stand).not.toBeNull();
  expect(stand!.position).toBe("fixed");
  // The card stands over the chip (the above's stand) or below it (the
  // viewport-top's flip) — never overlapping.
  expect(stand!.above || stand!.below).toBe(true);

  // The exit: the pointer leaves the zone (the chip and the card) — the
  // card closes.
  await a.mouse.move(10, 10);
  await expect.poll(async () => card.isVisible(), SETTLE).toBe(false);
  await expect(card).toHaveCount(0);

  await close();
});

test("the chip's click stands the consumer's stand (the delivery, no package card)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-card-click");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await standChip(a, "a", blockId);
  const chip = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);

  // The click: the package delivers the target to the consumer (the demo's
  // stand — the banner + the window's hook) and opens nothing of its own.
  await chip.click();
  const banner = a.locator('[data-slot="playground/mention-banner"]');
  await expect.poll(async () => banner.isVisible(), SETTLE).toBe(true);
  await expect(banner).toHaveText("Mention click: Ada Lovelace");
  const target = await a.evaluate(
    () => (window as unknown as { __mentionClick?: { kind: string; id: string; label: string } }).__mentionClick ?? null
  );
  expect(target).toEqual({ kind: "user", id: "u1", label: "Ada Lovelace" });
  await expect(a.locator('[data-slot="docblocks/mention-card"]')).toHaveCount(0);

  await close();
});
