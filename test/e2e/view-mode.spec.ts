// The document mode (the consumer-controlled access's contract) — the view's
// mode's read-only's stands: the page's read-only's stand (the caret's and
// the selection's and the gutter's and the toolbar's stands off, the type's
// stand no write), the canvas's read-only's stand (the dock's stand off, the
// zoom's and the pan's stands on, the dblclick's stands off), the empty text
// chains' collapse (the edit's mode stands the full stand — the collapse
// stands over the view's modes only), and the table's / the cell's
// read-only's stand.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, canvasCenter, insertBlockType, openPane, seedShape, twoPanes } from "./helpers";

interface PaneJson {
  meta: { title: string; avatar: string | null };
  blocks: Record<string, { type: string; content?: { text: string; marks: Record<string, unknown> }[] }>;
}

/** The pane's live doc's JSON (the __paneDocs' harness stand). */
async function paneDocJson(page: Page, client: "a" | "b"): Promise<PaneJson> {
  return (await page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.toJSON();
  }, client)) as unknown as PaneJson;
}

/** The doc's blocks' count over the type (the stand's parity pin). */
function countOfType(json: PaneJson, type: string): number {
  return Object.values(json.blocks).filter((block) => block.type === type).length;
}

/** The mode switcher's option (the DocHeader's segment's button). */
const modeOption = (page: Page, label: string) =>
  page.locator(`[data-slot="docblocks/doc-header-mode"] button[aria-label="${label}"]`);

/** The pane's page rows (the flat page's row stand). */
const pageRows = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/row"]`);

/** Switch the pane's mode to the view's mode and pin the read-only's stand. */
async function toViewMode(page: Page): Promise<void> {
  await modeOption(page, "View mode").click();
  await expect(page.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
}

test("the view mode stands the page read-only (the caret's and the write's stands off)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openPane(page, "a", "vm-page");
  try {
    // The seed: the starter's empty paragraph (the pane's seeder) + the text's
    // paragraph.
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "hello view");
    });
    await expect(page.locator('[data-slot="docblocks/page"]').first()).toContainText("hello view", SETTLE);
    const before = JSON.stringify(await paneDocJson(page, "a"));
    await toViewMode(page);
    // The read-only's stand: the inner's contenteditable=false, the gutter's
    // stand off.
    await expect(page.locator('[data-slot="docblocks/block-content"]').first()).toHaveAttribute(
      "contenteditable",
      "false"
    );
    await expect(page.locator('[data-slot="docblocks/gutter"]')).toHaveCount(0);
    // The press + the type stand no caret and no write (the type lands
    // nowhere).
    await page.locator('[data-slot="docblocks/block-content"]').first().click();
    await page.keyboard.type("x");
    await new Promise((resolve) => setTimeout(resolve, 200));
    // The format toolbar's stand off over the press (the selection's stand
    // off — no toolbar's entry).
    await expect(page.locator('[data-slot="docblocks/format-toolbar"]')).toHaveCount(0);
    expect(JSON.stringify(await paneDocJson(page, "a"))).toBe(before);
  } finally {
    await context.close();
  }
});

test("the view mode stands the canvas read-only (the dock's stand off, the zoom's stand on)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const room = `vm-canvas-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(page, "a", room, { url: `/?client=a&syncUrl=${RELAY}/${room}&canvas=1` });
  try {
    await seedShape(page, "a");
    await toViewMode(page);
    // The dock's stand off; the zoom controls' stand on (the zoom is the
    // view state — the read-only's stand keeps it).
    await expect(page.locator('[data-slot="docblocks/canvas-dock"]')).toHaveCount(0);
    const zoom = page.getByRole("button", { name: "Reset zoom" });
    const before = (await zoom.innerText()).trim();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await zoom.innerText()).trim(), SETTLE).not.toBe(before);
    // The dblclick's stand off (the ghost's text's creation's stand off —
    // no canvas-text's block stands over the canvas's seed's stand).
    const beforeBlocks = await paneDocJson(page, "a");
    const center = await canvasCenter(page, "a");
    await page.mouse.dblclick(center.x, center.y);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const json = await paneDocJson(page, "a");
    expect(countOfType(json, "canvas-text")).toBe(countOfType(beforeBlocks, "canvas-text"));
  } finally {
    await context.close();
  }
});

test("the empty text chains collapse over the view's modes (the edit's mode stands the full stand)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openPane(page, "a", "vm-collapse");
  try {
    // The seed: the starter's empty paragraph + the three empties + the
    // tail's text's paragraph (the one non-empty over the flat page).
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "tail");
    });
    // The edit's mode: the full's rows' stand (the count stands over the
    // JSON's blocks' stand — the starter's parity is independent: the
    // pane's seeder's stand may stand the one's more empty's paragraph).
    const editJson = await paneDocJson(page, "a");
    const paragraphs = Object.values(editJson.blocks).filter((block) => block.type === "paragraph").length;
    expect(paragraphs).toBeGreaterThanOrEqual(4); // the three empties + the tail's text's paragraph
    await expect(pageRows(page, "a")).toHaveCount(paragraphs, SETTLE);
    await toViewMode(page);
    // The view's mode: the chain's collapse (the empties' chain stands the
    // one's row + the tail — the two rows).
    await expect(pageRows(page, "a")).toHaveCount(2, SETTLE);
    // The data stands untouched (the collapse is the render's stand, the
    // doc's blocks stand the paragraphs' stand).
    const json = await paneDocJson(page, "a");
    expect(Object.values(json.blocks).filter((block) => block.type === "paragraph").length).toBe(paragraphs);
    // The switch back: the full stand returns (the data was never the
    // collapsed's stand).
    await modeOption(page, "Edit mode").click();
    await expect(pageRows(page, "a")).toHaveCount(paragraphs, SETTLE);
  } finally {
    await context.close();
  }
});

test("the presence's overlay stands off over the view's mode (the peer's caret stands no render)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const { a, b, close } = await twoPanes(browser, "vm-presence");
  try {
    // A: the live's content + the real's caret (the peer's selection's
    // stand over the wire's awareness).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "presence source");
    });
    await expect(a.locator('[data-slot="docblocks/page"]').first()).toContainText("presence source", SETTLE);
    await a.locator('[data-slot="docblocks/block-content"]').first().click();
    // The edit's parity: the peer's caret renders over B (the presence's
    // feed's live stand over the edit's mode).
    await expect
      .poll(async () => b.locator('[data-slot="docblocks/presence-caret"]').count(), SETTLE)
      .toBeGreaterThanOrEqual(1);
    // B: the view's mode — the peer's caret stands no render over the
    // read-only's stand.
    await modeOption(b, "View mode").click();
    await expect(b.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
    await expect(b.locator('[data-slot="docblocks/presence-caret"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the table's and the cell's read-only stands over the view's modes", async ({ browser }: { browser: Browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await openPane(page, "a", "vm-table");
  try {
    await insertBlockType(page, "a", "table");
    const table = page.locator('table[data-slot="docblocks/table"]').first();
    await expect(table).toBeVisible(SETTLE);
    // The edit's mode's stand: the resize seam's and the add's chips' stand
    // on (the gate's parity pin).
    await expect(page.locator('[data-slot="docblocks/table-col-resize"]').first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add column" })).toBeVisible();
    await toViewMode(page);
    // The read-only's stand: the seam's and the add's chips' stands off,
    // the cell's content stands contenteditable=false.
    await expect(page.locator('[data-slot="docblocks/table-col-resize"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add column" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add row" })).toHaveCount(0);
    const cells = page.locator('td[data-slot="docblocks/table-cell"] [data-slot="docblocks/block-content"]');
    await expect(cells.first()).toHaveAttribute("contenteditable", "false");
    expect(await cells.count()).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
