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

  // The press's stand (the cross drag's island guard): the chip is a
  // non-editable island, so the click starts no caret session — the text
  // editable takes no focus and the scroll port does not move to the
  // chip's line. The tall page stands the scroll's stand (the content
  // grows so the port can scroll).
  await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return;
    doc.transact(() => {
      for (let i = 0; i < 30; i += 1) doc.insertBlock("paragraph");
    });
  });
  await chip.scrollIntoViewIfNeeded();
  const pressBefore = await a.evaluate(() => ({
    scrollY: window.scrollY,
    activeSlot:
      document.activeElement instanceof Element
        ? (document.activeElement.closest("[data-slot]")?.getAttribute("data-slot") ?? null)
        : null,
    innerFocused:
      document.activeElement !== null &&
      document.activeElement.closest?.('[data-slot="docblocks/block-content"]') !== null,
  }));
  // The click: the package delivers the target to the consumer (the demo's
  // stand — the banner + the window's hook) and opens nothing of its own.
  await chip.click();
  const banner = a.locator('[data-slot="playground/mention-banner"]');
  await expect.poll(async () => banner.isVisible(), SETTLE).toBe(true);
  await expect(banner).toHaveText("Mention click: Ada Lovelace");
  const target = await a.evaluate(
    () => (window as unknown as { __mentionClick?: { kind: string; id: string } }).__mentionClick ?? null
  );
  // The mark is the identity (the id-only stand — the label is the
  // consumer's resolution, never the mark's field).
  expect(target).toEqual({ kind: "user", id: "u1" });
  await expect(a.locator('[data-slot="docblocks/mention-card"]')).toHaveCount(0);
  const pressAfter = await a.evaluate(() => ({
    scrollY: window.scrollY,
    activeSlot:
      document.activeElement instanceof Element
        ? (document.activeElement.closest("[data-slot]")?.getAttribute("data-slot") ?? null)
        : null,
    innerFocused:
      document.activeElement !== null &&
      document.activeElement.closest?.('[data-slot="docblocks/block-content"]') !== null,
  }));
  expect(pressAfter.scrollY, "the click's scroll's stand (no jump to the chip's line)").toBe(pressBefore.scrollY);
  expect(pressAfter.innerFocused, "the chip's click takes no caret seat in the text editable").toBe(false);
  // The island's press plants no focus: the focus stands where it stood
  // (the press's own point's handlers run over the stable's port).
  expect(pressAfter.activeSlot, "the chip's click plants no focus of its own").toBe(pressBefore.activeSlot);

  await close();
});

test("the chip's click over the focus outside the editor stands no editor's focus (the island's press's no-focus's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "mention-card-click-focus");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await standChip(a, "a", blockId);
  const chip = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);

  // The tall page's stand (the content's growth — the scroll's port can
  // scroll: the root's focus's pull's stand is visible over the press).
  await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return;
    doc.transact(() => {
      for (let i = 0; i < 30; i += 1) doc.insertBlock("paragraph");
    });
  });

  // The consumer's stand (the fresh read's press): the editor's focus
  // stands outside (the body's focus — no caret's session over the read).
  await a.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });
  await chip.scrollIntoViewIfNeeded();
  const pressBefore = await a.evaluate(() => ({
    scrollY: window.scrollY,
    activeTag: document.activeElement?.tagName ?? null,
  }));
  expect(pressBefore.activeTag).toBe("BODY");

  // The click: the delivery stands (the consumer's navigation's stand),
  // the port's scroll stands stable (no jump over the press), and the
  // focus stands where it stood (the island's press plants no focus).
  await chip.click();
  const banner = a.locator('[data-slot="playground/mention-banner"]');
  await expect.poll(async () => banner.isVisible(), SETTLE).toBe(true);
  const pressAfter = await a.evaluate(() => ({
    scrollY: window.scrollY,
    activeTag: document.activeElement?.tagName ?? null,
    activeSlot:
      document.activeElement instanceof Element
        ? (document.activeElement.closest("[data-slot]")?.getAttribute("data-slot") ?? null)
        : null,
  }));
  expect(pressAfter.scrollY, "the chip's click stands no scroll's pull over the press").toBe(pressBefore.scrollY);
  expect(pressAfter.activeTag, "the chip's click plants no editor's focus").toBe("BODY");
  expect(pressAfter.activeSlot, "the chip's click plants no focus over the editor's slot").toBeNull();

  await close();
});

test("the chip's hover stands the link's cursor and the neutral's highlight (the fade)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-card-hover-style");
  const blockId = await insertBlockType(a, "a", "paragraph");
  await standChip(a, "a", blockId);
  const chip = editorOf(a, "a").locator('[data-slot="docblocks/mention"]');
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);
  // The root's interactive stand (the consumer's mention interactions).
  await expect(editorOf(a, "a")).toHaveAttribute("data-mention-interactive", "true");

  // The rest's stand: the link's cursor, the rounded rect's offset, the
  // fade's transition — and no background before the hover.
  const rest = await chip.evaluate((el) => {
    const style = getComputedStyle(el);
    return {
      cursor: style.cursor,
      radius: style.borderRadius,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      transitionProperty: style.transitionProperty,
      transitionDuration: style.transitionDuration,
      background: style.backgroundColor,
    };
  });
  expect(rest.cursor).toBe("pointer");
  expect(rest.radius).toBe("3px");
  expect(rest.paddingLeft).toBe("2px");
  expect(rest.paddingRight).toBe("2px");
  expect(rest.transitionProperty).toBe("background-color");
  expect(rest.transitionDuration).toBe("0.12s");
  const transparent = /rgba\(0, 0, 0, 0\)|transparent/.test(rest.background);
  expect(transparent, `the rest's background (${rest.background})`).toBe(true);

  // The hover: the neutral's background over the fade (the transition's
  // settle's poll).
  await chip.hover();
  await expect
    .poll(
      async () =>
        chip.evaluate((el) => {
          const bg = getComputedStyle(el).backgroundColor;
          return /rgba\(0, 0, 0, 0\)|transparent/.test(bg) ? "" : bg;
        }),
      { timeout: SETTLE.timeout }
    )
    .not.toBe("");
  await close();
});
