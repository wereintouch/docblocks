// The canvas empty-area double-click: a double-click
// over the page miniature's blank body (no block under the point) or over the
// empty canvas (outside the card) stands NO selection and writes nothing —
// the single-press select (the move session's affordance) stands, but the
// dblclick clears it. The card's content keeps its contracts (the two-click
// caret, the block's own gestures) — the clear stands for the blank body only.
import { type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

/** Switch the pane to the canvas view (the harness's view toggle). */
async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

/** The canvas-view container (the viewport's chrome root). */
const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The zoom label (the "Reset zoom" button's text). */
const zoomPercent = (page: Page, client: "a" | "b") => zoomToolbar(page, client).getByLabel("Reset zoom");

/** Drive the zoom to the target's label (the 10% steps / the 25% floor). */
async function zoomTo(page: Page, client: "a" | "b", target: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    const current = (await zoomPercent(page, client).textContent()) ?? "100%";
    if (current === target) return;
    const btn =
      Number(target.replace("%", "")) > Number(current.replace("%", ""))
        ? zoomToolbar(page, client).getByLabel("Zoom in")
        : zoomToolbar(page, client).getByLabel("Zoom out");
    await btn.click();
    await page.waitForTimeout(60);
  }
  throw new Error(`could not reach the zoom's ${target} stand`);
}

/** The selection's stand: the selected items + the resize handles' count. */
async function selectionStand(page: Page, client: "a" | "b"): Promise<{ items: string[]; handles: number }> {
  return page.evaluate(
    ({ client }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      const items = Array.from(
        view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")
      ).map((el) => el.dataset.blockId as string);
      const handles = view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-handle']").length;
      return { items, handles };
    },
    { client }
  );
}

/** The doc's JSON (the no-write invariant). */
const docJson = (page: Page) => page.evaluate(() => window.__paneDocs?.a?.toJSON() ?? null);

/** The point's element classification (inCard / inBlock — the blank-body pin). */
async function pointClass(page: Page, x: number, y: number): Promise<{ inCard: boolean; inBlock: boolean }> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return {
        inCard: el !== null && el.closest('[data-slot="docblocks/page-card"]') !== null,
        inBlock: el !== null && el.closest('[data-slot="docblocks/block"]') !== null,
      };
    },
    { x, y }
  );
}

test.describe("the canvas empty-area double-click", () => {
  test("stands no selection over the page's blank body (the doc stands)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-empty-dblclick-card-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      // Zoom out so the whole card (the starter paragraph's top + the blank
      // body) stands in the viewport and the point's stand is unambiguous.
      await zoomTo(page, "a", "25%");

      const card = (await canvasView(page, "a").locator('[data-slot="docblocks/page-card"]').boundingBox())!;
      // The blank body: the card's center over the lower stretch (below the
      // starter paragraph — the blank body's point stands no block).
      const px = card.x + card.width / 2;
      const py = card.y + card.height * 0.75;
      expect(await pointClass(page, px, py)).toEqual({ inCard: true, inBlock: false });

      const before = await selectionStand(page, "a");
      expect(before.items).toEqual([]);
      expect(before.handles).toBe(0);
      const jsonBefore = await docJson(page);

      await page.mouse.dblclick(px, py);

      // The dblclick stands no selection (the press's select is cleared) and
      // writes nothing (the selection is the view state — the doc stands).
      const after = await selectionStand(page, "a");
      expect(after.items).toEqual([]);
      expect(after.handles).toBe(0);
      expect(await docJson(page)).toEqual(jsonBefore);
    } finally {
      await context.close();
    }
  });

  test("stands no selection over the empty canvas (outside the card)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-empty-dblclick-canvas-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      await zoomTo(page, "a", "25%");

      const view = (await canvasView(page, "a").boundingBox())!;
      // The empty canvas: the view's top-left corner (the card stands centered
      // and smaller — the corner stands outside it).
      const px = view.x + 12;
      const py = view.y + 12;
      expect(await pointClass(page, px, py)).toEqual({ inCard: false, inBlock: false });

      const before = await selectionStand(page, "a");
      expect(before.items).toEqual([]);
      expect(before.handles).toBe(0);
      const jsonBefore = await docJson(page);

      await page.mouse.dblclick(px, py);

      const after = await selectionStand(page, "a");
      expect(after.items).toEqual([]);
      expect(after.handles).toBe(0);
      expect(await docJson(page)).toEqual(jsonBefore);
    } finally {
      await context.close();
    }
  });

  test("keeps the single-press select over the blank body (the move affordance)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-empty-dblclick-press-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      await zoomTo(page, "a", "25%");

      const card = (await canvasView(page, "a").locator('[data-slot="docblocks/page-card"]').boundingBox())!;
      const px = card.x + card.width / 2;
      const py = card.y + card.height * 0.75;
      expect(await pointClass(page, px, py)).toEqual({ inCard: true, inBlock: false });
      const jsonBefore = await docJson(page);

      // The single press selects the card (the move session's affordance) —
      // the handles stand (the selection's resize handles' target) — and
      // writes nothing (the selection is the view state; a no-op move's
      // release commits no setGeometry).
      await page.mouse.click(px, py);
      const after = await selectionStand(page, "a");
      expect(after.handles).toBe(8);
      expect(await docJson(page)).toEqual(jsonBefore);
    } finally {
      await context.close();
    }
  });
});
