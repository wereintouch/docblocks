// The plain-text paste's linkify over the real browser: the bare URL and
// the email stand the link's marks (the anchors render, the email's href
// is the mailto's form), while the phone's digits stand plain (the
// manual's link's stand) and the code target keeps its raw text.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, pasteFromClipboard, seedClipboardPayload, twoPanes } from "./helpers";

const inner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();

/** The pane's first block's linked runs (the text + the href). */
async function linkedRuns(page: Page): Promise<{ text: string; href: string }[]> {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc stands absent");
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    const runs = doc.getBlock(id)?.content ?? [];
    return runs.flatMap((run) => {
      const link = run.marks.link as { href?: string } | undefined;
      return link?.href === undefined ? [] : [{ text: run.text, href: link.href }];
    });
  });
}

test("a pasted URL and email stand the linked runs (the bare's + the mailto's forms)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-paste", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    await inner(a, "a").click();
    await seedClipboardPayload(a, { plain: "see https://example.com/page and user@example.com ok" });
    await pasteFromClipboard(a);
    await expect
      .poll(() => linkedRuns(a), SETTLE)
      .toEqual([
        { text: "https://example.com/page", href: "https://example.com/page" },
        { text: "user@example.com", href: "mailto:user@example.com" },
      ]);
    // The anchors' render over the safe's gate (the address's text stands).
    const anchors = a.locator('[data-testid="doc-a"] a[data-slot="docblocks/link"]');
    await expect(anchors).toHaveCount(2);
    await expect(anchors.nth(1)).toHaveAttribute("href", "mailto:user@example.com");
    await expect(anchors.nth(1)).toHaveText("user@example.com");
  } finally {
    await close();
  }
});

test("a pasted phone stands the plain text (the manual link's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-paste-phone", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    await inner(a, "a").click();
    await seedClipboardPayload(a, { plain: "call +7 (916) 123-45-67 now" });
    await pasteFromClipboard(a);
    await expect.poll(() => inner(a, "a").textContent(), SETTLE).toContain("+7 (916) 123-45-67");
    // No linked run, no anchor (the digits' false's stand).
    expect(await linkedRuns(a)).toEqual([]);
    await expect(a.locator('[data-testid="doc-a"] a[data-slot="docblocks/link"]')).toHaveCount(0);
  } finally {
    await close();
  }
});
