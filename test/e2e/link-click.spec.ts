// The link's click's contract over the real browser (the contenteditable's
// anchor's gap): the browser cancels the anchor's navigation default inside
// a CE, so the editor opens the href itself — the new tab's stand (the
// `noopener,noreferrer`'s parity) over the edit and the view's modes (the
// parity — the reader's same-tab's carry-away's off), the editor's state
// untouched (no navigation over the main page, the focus's stand, the
// text's no-write's stand). The press-drag over the link (the selection's
// gesture) stands no open; the unsafe scheme's text (the renderer's gate's
// plain stand) stays inert.
import { type Page, expect, test } from "@playwright/test";

import { expectStays, twoPanes } from "./helpers";

const HREF = "https://example.org/page";
const TEXT = "go to world now";
// The "world"'s run (the mark's range over the text).
const MARK_FROM = 6;
const MARK_TO = 11;

/** The pane's page rows' first text inner (the seeded paragraph). */
const firstInner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();

/** Type the fixture's text into the seeded (empty) paragraph. */
async function seedText(page: Page, client: "a" | "b"): Promise<void> {
  const inner = firstInner(page, client);
  await inner.click();
  await page.keyboard.type(TEXT);
}

/** Apply the link's mark over the "world"'s run (the semantic API). */
async function applyLinkMark(page: Page, client: "a" | "b"): Promise<void> {
  await page.evaluate(
    ({ client, href, from, to }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      const id = doc.getChildren(doc.toJSON().id)[0]!;
      doc.setMark(id, from, to, { type: "link", href });
    },
    { client, href: HREF, from: MARK_FROM, to: MARK_TO }
  );
}

/** The link's anchor over the pane's page. */
const linkAnchor = (page: Page, client: "a" | "b") => firstInner(page, client).locator("a[href]");

test("the edit's mode: the plain click opens the new tab (the main page's stand untouched — the focus's + the text's no-write's stands)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "link-click-edit");
  try {
    await seedText(a, "a");
    await applyLinkMark(a, "a");
    await expect(linkAnchor(a, "a")).toHaveAttribute("href", HREF);
    await expect(linkAnchor(a, "a")).toHaveAttribute("rel", "noopener noreferrer");

    const context = a.context();
    const [popup] = await Promise.all([context.waitForEvent("page"), linkAnchor(a, "a").click()]);
    expect(popup.url()).toBe(HREF);

    // The main page's stand (no navigation, the focus over the page's
    // editable, the text's no-write's stand — over the wire's parity too).
    expect(a.url()).toContain("localhost:5173");
    expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/page");
    await expect(firstInner(a, "a")).toContainText(TEXT);
    await expect(firstInner(b, "b")).toContainText(TEXT);
  } finally {
    await close();
  }
});

test("the edit's mode: the press-drag over the link stands no open (the selection's gesture's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "link-click-drag");
  try {
    await seedText(a, "a");
    await applyLinkMark(a, "a");
    await expect(linkAnchor(a, "a")).toHaveAttribute("href", HREF);

    const anchor = linkAnchor(a, "a");
    const box = await anchor.boundingBox();
    if (box === null) throw new Error("the anchor's box is missing");
    // The press over the link's start, the drag's stand (the selection's
    // gesture over the link), the release — no open.
    await a.mouse.move(box.x + 1, box.y + box.height / 2);
    await a.mouse.down();
    await a.mouse.move(box.x + box.width + 60, box.y + box.height / 2, { steps: 5 });
    await a.mouse.up();
    await expectStays(async () => {
      expect(a.context().pages()).toHaveLength(1);
    });
    // The gesture's selection's stand (the caret's no-seat's parity over
    // the drag — the selection's range stands over the link's text).
    expect(await a.evaluate(() => window.getSelection()?.toString().length)).toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test("the view's mode stands the same open (the parity — the same-tab's carry-away's off)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-click-view");
  try {
    await seedText(a, "a");
    await applyLinkMark(a, "a");
    // The view's mode's stand (the read-only's page's stand).
    await a.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
    await expect(a.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");

    const context = a.context();
    const [popup] = await Promise.all([context.waitForEvent("page"), linkAnchor(a, "a").click()]);
    expect(popup.url()).toBe(HREF);
    // The same-tab's carry-away's off (the main page's stand).
    expect(a.url()).toContain("localhost:5173");
  } finally {
    await close();
  }
});

test("the crafted unsafe scheme stands the plain text (the inert's stand — no open, the renderer's gate's parity)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "link-click-unsafe");
  try {
    await seedText(a, "a");
    // The raw Yjs's write (the remote input's stand — the validator is not
    // in the apply path): the `javascript:`'s scheme's gate's stand.
    await a.evaluate(
      ([c, from, to]) => {
        const doc = window.__paneDocs?.[c];
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const id = doc.getChildren(doc.toJSON().id)[0]!;
        const yblocks = doc.raw.getMap("blocks");
        const yblock = yblocks.get(id) as { get: (key: string) => unknown };
        const ytext = yblock.get("content") as { format: (start: number, length: number, attrs: unknown) => void };
        ytext.format(from, to - from, { link: { href: "javascript:alert(1)" } });
      },
      ["a", MARK_FROM, MARK_TO] as const
    );

    await expect(linkAnchor(a, "a")).toHaveCount(0);
    const inner = firstInner(a, "a");
    await inner.click();
    await expectStays(async () => {
      expect(a.context().pages()).toHaveLength(1);
    });
  } finally {
    await close();
  }
});
