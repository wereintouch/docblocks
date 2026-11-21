// The link editor's UX over the real browser: the creation's paths (the
// format toolbar's button, the mod+k's shortcut — the uniform link's
// prefill over the edit, the selection's life over the popover's open —
// the re-seat's window's stand), the smart scheme's inference (the bare's
// form stands the `https://`'s prefix), the popover's invalid's / the
// Escape's no-write's stands, and the anchor's right-click menu (the
// edit's mode: the open + the copy + the edit + the remove; the view's
// mode: the open + the copy only — the read-only's stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

const HREF = "https://example.org/page";
// The "world"'s run (the link's range over the text).
const MARK_FROM = 6;
const MARK_TO = 11;
const TEXT = "go to world now";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

const firstInner = (page: Page, client: "a" | "b") =>
  pane(page, client).locator('[data-slot="docblocks/block-content"]').first();

/** Type the fixture's text into the seeded (empty) paragraph. */
async function seedText(page: Page, client: "a" | "b"): Promise<void> {
  const inner = firstInner(page, client);
  await inner.click();
  await page.keyboard.type(TEXT);
}

/** Select the whole line (the caret at the end + Shift+Home). */
async function selectAll(page: Page): Promise<void> {
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

/** The pane's live doc's runs (the harness's `__paneDocs` stand). */
async function runsOf(page: Page, client: "a" | "b"): Promise<{ text: string; marks: Record<string, unknown> }[]> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    const block = doc.getBlock(id)!;
    return block.content ?? [];
  }, client);
}

const linkRuns = (runs: { text: string; marks: Record<string, unknown> }[]) =>
  runs.filter((run) => run.marks.link !== undefined);

const toolbar = (page: Page) => page.locator('[data-slot="docblocks/format-toolbar"]');
const linkButton = (page: Page) => toolbar(page).locator("[data-link-btn]");
const popover = (page: Page) => page.locator('[data-slot="docblocks/link-popover"]');
const popoverInput = (page: Page) => popover(page).locator("input");
const linkMenu = (page: Page) => page.locator('[data-slot="docblocks/link-menu"]');
const menuButton = (page: Page, label: string) => linkMenu(page).getByRole("menuitem", { name: label });

/** Seed the "world"'s run over the link mark (the semantic API). */
async function seedLink(page: Page): Promise<void> {
  await page.evaluate(
    ({ from, to, href }) => {
      const docs = window.__paneDocs;
      const doc = docs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc stands absent");
      const id = doc.getChildren(doc.toJSON().id)[0]!;
      doc.setMark(id, from, to, { type: "link", href });
    },
    { from: MARK_FROM, to: MARK_TO, href: HREF }
  );
}

test("the toolbar's link button creates the link over the selection (the smart inference's stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "link-editor-toolbar");
  try {
    await seedText(a, "a");
    await selectAll(a);
    await expect(toolbar(a)).toBeVisible(SETTLE);
    await linkButton(a).click();
    await expect(popover(a)).toBeVisible(SETTLE);

    // The bare's domain stands the `https://`'s prefix over the commit.
    await popoverInput(a).fill("example.org/page");
    await popoverInput(a).press("Enter");
    await expect(popover(a)).toBeHidden();

    const runs = await runsOf(a, "a");
    expect(linkRuns(runs).map((run) => run.marks.link)).toEqual([{ href: HREF }]);
    expect(
      linkRuns(runs)
        .map((run) => run.text)
        .join("")
    ).toBe(TEXT);

    // The anchor's render (the safe href's gate) + the other pane's sync.
    const anchor = firstInner(a, "a").locator("a[data-slot='docblocks/link']");
    await expect(anchor).toHaveAttribute("href", HREF);
    await expect
      .poll(async () => (await runsOf(b, "b")).filter((run) => run.marks.link !== undefined).length, SETTLE)
      .toBe(1);
  } finally {
    await close();
  }
});

test("the toolbar's link button edits the uniform link (the prefill's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-editor-edit");
  try {
    await seedText(a, "a");
    await seedLink(a);
    const anchor = firstInner(a, "a").locator("a[data-slot='docblocks/link']");
    await expect(anchor).toHaveText("world");

    // The selection over the linked's word only (the whole line's stand is
    // the mixed's — the prefill's / the active's stands stand over the
    // uniform's range): the double-click's word's selection's stand.
    await anchor.dblclick();
    await expect(toolbar(a)).toBeVisible(SETTLE);
    await expect(linkButton(a)).toHaveAttribute("aria-pressed", "true");
    await linkButton(a).click();
    await expect(popoverInput(a)).toHaveValue(HREF);
    await popoverInput(a).fill("https://edited.example");
    await popoverInput(a).press("Enter");

    // The commit stands over the word's range only (the rest's plain's
    // stand).
    const runs = await runsOf(a, "a");
    expect(linkRuns(runs).map((run) => [run.text, run.marks.link])).toEqual([
      ["world", { href: "https://edited.example" }],
    ]);
  } finally {
    await close();
  }
});

test("the mod+k opens the popover over the selection; the Escape closes without a write", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-editor-shortcut");
  try {
    await seedText(a, "a");
    await selectAll(a);

    // The mod+k's open (the popover's stand over the selection).
    await a.keyboard.down("Control");
    await a.keyboard.press("k");
    await a.keyboard.up("Control");
    await expect(popover(a)).toBeVisible(SETTLE);

    // The Escape's no-write's close (the selection's life over it — the
    // re-seat's window's stand; the doc's no-write's stand).
    await popoverInput(a).press("Escape");
    await expect(popover(a)).toBeHidden();
    const runs = await runsOf(a, "a");
    expect(linkRuns(runs)).toEqual([]);

    // The selection stands the close (the toolbar's re-show's stand).
    await expect(toolbar(a)).toBeVisible(SETTLE);

    // The mod+k's re-open over the closed's popover (the editor root's
    // parked focus's stand — the second gesture's reach).
    await a.keyboard.down("Control");
    await a.keyboard.press("k");
    await a.keyboard.up("Control");
    await expect(popover(a)).toBeVisible(SETTLE);

    // The mod+k over the popover's input stands the input's own key (the
    // no-reopen's stand — the entered value's no-reset's parity).
    await popoverInput(a).fill("https://draft.example");
    await popoverInput(a).press("Control+k");
    await expect(popover(a)).toBeVisible(SETTLE);
    await expect(popoverInput(a)).toHaveValue("https://draft.example");
    expect((await runsOf(a, "a")).filter((run) => run.marks.link !== undefined)).toEqual([]);
  } finally {
    await close();
  }
});

test("the popover's invalid stand keeps the popover open over the no-write", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-editor-invalid");
  try {
    await seedText(a, "a");
    await selectAll(a);
    await linkButton(a).click();
    await expect(popover(a)).toBeVisible(SETTLE);

    await popoverInput(a).fill("not a url at all");
    await popoverInput(a).press("Enter");
    await expect(popover(a)).toBeVisible(SETTLE); // the open's stand
    await expect(popover(a).locator('[data-slot="docblocks/link-popover-invalid"]')).toBeVisible();
    expect((await runsOf(a, "a")).filter((run) => run.marks.link !== undefined)).toEqual([]);

    // The valid's commit after the invalid's stand (the stand's clear).
    await popoverInput(a).fill("example.org");
    await popoverInput(a).press("Enter");
    await expect(popover(a)).toBeHidden();
    expect((await runsOf(a, "a")).filter((run) => run.marks.link !== undefined).map((run) => run.marks.link)).toEqual([
      { href: "https://example.org" },
    ]);
  } finally {
    await close();
  }
});

test("the right-click menu over the link: the edit's mode (the remove + the edit's stands)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "link-menu-edit");
  try {
    await seedText(a, "a");
    await seedLink(a);
    const anchor = firstInner(a, "a").locator("a[data-slot='docblocks/link']");
    await anchor.click({ button: "right" });
    await expect(linkMenu(a)).toBeVisible();

    // The edit's mode's control set (the four items' stand).
    await expect(menuButton(a, "Open link")).toBeVisible();
    await expect(menuButton(a, "Copy link address")).toBeVisible();
    await expect(menuButton(a, "Edit link")).toBeVisible();
    await expect(menuButton(a, "Remove link")).toBeVisible();

    // The edit's item opens the popover over the pre-filled href (the
    // menu's stand off — the popover's input's focus's take-over).
    await menuButton(a, "Edit link").click();
    await expect(linkMenu(a)).toBeHidden();
    await expect(popover(a)).toBeVisible(SETTLE);
    await expect(popoverInput(a)).toHaveValue(HREF);
    await popoverInput(a).press("Escape");
    await expect(popover(a)).toBeHidden();

    // The right-click's re-open + the remove (the text's stand, the mark's
    // off; the undo step's restore stands over the unit's pin — the
    // chromium-linux's native document-level undo's e2e's gap).
    await anchor.click({ button: "right" });
    await expect(linkMenu(a)).toBeVisible();
    await menuButton(a, "Remove link").click();
    await expect(linkMenu(a)).toBeHidden();
    expect((await runsOf(a, "a")).filter((run) => run.marks.link !== undefined)).toEqual([]);
    expect((await runsOf(a, "a")).map((run) => run.text).join("")).toBe(TEXT);
  } finally {
    await close();
  }
});

test("the right-click menu over the view's mode: the open + the copy only (the read-only's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "link-menu-view");
  try {
    await seedText(a, "a");
    await seedLink(a);

    // The view's mode's switch (the DocHeader's mode's stand).
    await a.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
    await expect(a.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");

    const anchor = firstInner(a, "a").locator("a[data-slot='docblocks/link']");
    await anchor.click({ button: "right" });
    await expect(linkMenu(a)).toBeVisible();
    await expect(menuButton(a, "Open link")).toBeVisible();
    await expect(menuButton(a, "Copy link address")).toBeVisible();
    await expect(linkMenu(a).getByRole("menuitem", { name: "Edit link" })).toBeHidden();
    await expect(linkMenu(a).getByRole("menuitem", { name: "Remove link" })).toBeHidden();

    // The menu's close (the escape) + the doc's no-write's stand.
    await a.keyboard.press("Escape");
    await expect(linkMenu(a)).toBeHidden();
    expect((await runsOf(a, "a")).filter((run) => run.marks.link !== undefined).map((run) => run.marks.link)).toEqual([
      { href: HREF },
    ]);
  } finally {
    await close();
  }
});
