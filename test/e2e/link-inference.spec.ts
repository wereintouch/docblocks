// The link popover's smart inference over the real browser: the typed
// address's form → the stored href — the explicit schemes, the
// protocol-relative form (the explicit https's stand), the relative's
// forms, the bare domain, the email, the phone, and the invalid's stand
// (the error, the no-write).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

// The inference table walks seven commits over one selection (each with the
// popover's open and the re-seat's settle) — the two-pane settle tier.
test.setTimeout(60_000);

const TEXT = "go to world now";

const firstInner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();

const toolbar = (page: Page) => page.locator('[data-slot="docblocks/format-toolbar"]');
const linkButton = (page: Page) => toolbar(page).locator("[data-link-btn]");
const popover = (page: Page) => page.locator('[data-slot="docblocks/link-popover"]');
const popoverInput = (page: Page) => popover(page).locator("input");
const anchor = (page: Page) => firstInner(page, "a").locator('[data-slot="docblocks/link"]');

/** The pane's linked runs' hrefs (the doc's own read). */
async function linkHrefs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc stands absent");
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    const runs = doc.getBlock(id)?.content ?? [];
    return runs.flatMap((run) => {
      const link = run.marks.link as { href?: string } | undefined;
      return link?.href !== undefined ? [link.href] : [];
    });
  });
}

/** Types the fixture's text, selects the whole line, opens the popover over it. */
async function openEditor(page: Page): Promise<void> {
  await firstInner(page, "a").click();
  await page.keyboard.type(TEXT);
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
  await expect(toolbar(page)).toBeVisible(SETTLE);
  await linkButton(page).click();
  await expect(popover(page)).toBeVisible(SETTLE);
}

test("the typed address resolves by form (the smart inference's table)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-inference");
  try {
    await openEditor(a);
    const cases = [
      // The bare domain stands the https's prefix.
      { input: "example.org/page", href: "https://example.org/page" },
      // The explicit scheme stands as-is.
      { input: "https://example.com/a?b=1", href: "https://example.com/a?b=1" },
      // The email's form stands the mailto's.
      { input: "user@example.com", href: "mailto:user@example.com" },
      // The phone's form stands the tel's.
      { input: "+7 (916) 123-45-67", href: "tel:+7 (916) 123-45-67" },
      // The relative's forms stand as-is.
      { input: "/docs/page", href: "/docs/page" },
      { input: "#section", href: "#section" },
      // The protocol-relative form stands the explicit https's (the stored
      // href is self-describing).
      { input: "//cdn.example.com/x", href: "https://cdn.example.com/x" },
    ];
    for (const { input, href } of cases) {
      await test.step(`the address "${input}" stands ${href}`, async () => {
        await popoverInput(a).fill(input);
        await popoverInput(a).press("Enter");
        await expect(popover(a)).toBeHidden();
        await expect.poll(() => linkHrefs(a), SETTLE).toEqual([href]);
        await expect(anchor(a)).toHaveAttribute("href", href);
      });
      // The next case's selection (the undo reverts the link's commit — one step).
      await a.evaluate(() => window.__paneDocs?.a?.undo());
      await expect(toolbar(a)).toBeVisible(SETTLE);
      await linkButton(a).click();
      await expect(popover(a)).toBeVisible(SETTLE);
    }
  } finally {
    await close();
  }
});

test("the invalid address stands the error and writes nothing", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-inference-invalid");
  try {
    await openEditor(a);
    await popoverInput(a).fill("javascript:alert(1)");
    await popoverInput(a).press("Enter");
    // The popover stands open over the invalid's message (no close, no write).
    await expect(popover(a)).toBeVisible();
    await expect(popover(a).locator('[data-slot="docblocks/link-popover-invalid"]')).toBeVisible();
    expect(await linkHrefs(a)).toEqual([]);
    // The Escape closes without a write.
    await popoverInput(a).press("Escape");
    await expect(popover(a)).toBeHidden();
    expect(await linkHrefs(a)).toEqual([]);
  } finally {
    await close();
  }
});
