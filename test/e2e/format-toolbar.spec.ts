import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The inner contenteditables of the pane's text blocks, in order. */
function inners(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/block-content"]');
}

/** The pane's floating format toolbar (absent while no eligible range is selected). */
function toolbar(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/format-toolbar"]');
}

/** The first block's snapshot (the seeded paragraph the tests type into). */
async function firstBlock(
  page: Page,
  client: "a" | "b"
): Promise<{ attrs?: Record<string, unknown>; content?: { text: string; marks: Record<string, unknown> }[] }> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const json = doc.toJSON();
    const id = doc.getChildren(json.id)[0]!;
    return doc.getBlock(id)!;
  }, client);
}

/** Type the fixture text into the seeded paragraph and select the whole line. */
async function typeAndSelectAll(page: Page, client: "a" | "b"): Promise<void> {
  const inner = inners(page, client).first();
  await inner.click();
  await page.keyboard.type("hello world");
  // The caret is at the end; Shift+Home selects the whole line.
  await page.keyboard.down("Shift");
  await page.keyboard.press("Home");
  await page.keyboard.up("Shift");
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
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

test("a range selection raises the floating toolbar; a collapsed selection dismisses it", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ux05-fmt-visible");
  const inner = inners(a, "a").first();
  await inner.click();
  await a.keyboard.type("hello world");
  await expect(toolbar(a, "a")).toHaveCount(0);

  await a.keyboard.down("Shift");
  await a.keyboard.press("Home");
  await a.keyboard.up("Shift");
  await expect(toolbar(a, "a")).toBeVisible();
  // The control set: the five mark buttons, the three align buttons, the
  // list-type button, and the palette button.
  await expect(toolbar(a, "a").locator("button")).toHaveCount(10);

  // Collapsing the selection (a plain click) dismisses the toolbar.
  await inner.click();
  await expect(toolbar(a, "a")).toHaveCount(0);
  await close();
});

test("the mark buttons apply and clear a mark over the selected range", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux05-fmt-bold");
  await typeAndSelectAll(a, "a");
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();

  // Bold on: the button reads active and the run carries the mark.
  const bold = bar.locator('[data-mark="bold"]');
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "true");
  let block = await firstBlock(a, "a");
  expect((block.content ?? []).find((run) => run.text === "hello world")?.marks.bold).toBe(true);

  // The mark reached the other pane (doc-level sync) and rendered bold there.
  await expect
    .poll(async () => (await firstBlock(b, "b")).content?.find((run) => run.text === "hello world")?.marks.bold, SETTLE)
    .toBe(true);
  await expect(inners(b, "b").first().locator("strong")).toHaveText("hello world");

  // Bold off: the same button clears the mark over the range.
  await bold.click();
  await expect(bold).toHaveAttribute("aria-pressed", "false");
  block = await firstBlock(a, "a");
  expect((block.content ?? []).find((run) => run.text === "hello world")?.marks.bold).toBeUndefined();
  await close();
});

test("the palette applies a background highlight, then a text color, then clears it", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ux05-fmt-palette");
  await typeAndSelectAll(a, "a");
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();

  // The palette opens at the palette button (the background target is the
  // default) and a swatch applies the highlight mark. The palette content
  // is portaled to the document body (radix), so the locator is page-scoped.
  await bar.locator('[data-target="highlight"]').click();
  const palette = a.locator('[data-slot="docblocks/format-palette"]');
  await expect(palette).toBeVisible();
  await palette.locator('[data-color="#e11d48"]').click();
  // The palette stays open for the next pick (applying a color does not
  // move the selection).
  await expect(palette).toBeVisible();
  let block = await firstBlock(a, "a");
  expect((block.content ?? []).find((run) => run.text === "hello world")?.marks.highlight).toEqual({
    value: "#e11d48",
  });

  // The text target applies the color mark alongside the highlight.
  await a.locator('[data-target-btn="color"]').click();
  await palette.locator('[data-color="#3b82f6"]').click();
  block = await firstBlock(a, "a");
  const worldRun = (block.content ?? []).find((run) => run.text === "hello world");
  expect(worldRun?.marks.color).toEqual({ value: "#3b82f6" });
  expect(worldRun?.marks.highlight).toEqual({ value: "#e11d48" });

  // Both marks render on the text span (color + background).
  const span = inners(a, "a").first().locator("span");
  await expect(span).toHaveCSS("color", "rgb(59, 130, 246)");
  await expect(span).toHaveCSS("background-color", "rgb(225, 29, 72)");

  // The "no color" entry clears the active target's mark (color here).
  await palette.locator('[data-color="none"]').click();
  block = await firstBlock(a, "a");
  const cleared = (block.content ?? []).find((run) => run.text === "hello world");
  expect(cleared?.marks.color).toBeUndefined();
  expect(cleared?.marks.highlight).toEqual({ value: "#e11d48" });
  await close();
});

test("the align buttons set the block's align attr and sync the data-align", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux05-fmt-align");
  await typeAndSelectAll(a, "a");
  const bar = toolbar(a, "a");
  await expect(bar).toBeVisible();

  const center = bar.locator('[data-align-btn="center"]');
  await expect(center).toHaveAttribute("aria-pressed", "false");
  await center.click();
  await expect(center).toHaveAttribute("aria-pressed", "true");

  // The block carries the attr (the data attribute is the style hook) and
  // the content element is center-aligned.
  const wrapper = pane(a, "a").locator('[data-block-type="paragraph"]').first();
  await expect(wrapper).toHaveAttribute("data-align", "center");
  await expect(wrapper.locator('[data-slot="docblocks/block-content"]')).toHaveCSS("text-align", "center");

  // The attr synced to the other pane.
  await expect(pane(b, "b").locator('[data-block-type="paragraph"]').first()).toHaveAttribute("data-align", "center");
  await close();
});
