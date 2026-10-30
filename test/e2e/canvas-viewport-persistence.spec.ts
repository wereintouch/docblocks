// The canvas viewport's browser persistence:
// the per-document zoom / pan over localStorage — the map docId -> { zoom,
// pan }. The entry's stand: the stored state's restore (the zoom / pan) or
// the fit (the no-stored-state's first visit — the clean storage's default).
// The change's commit (the zoom / pan's debounced write) stands over the
// reload / the new tab / the page<->canvas switch (the shared origin).
// Pure view state — the doc's own data stands.
import { type Page, expect, test } from "@playwright/test";

import { canvasView, openPane, switchPaneView, toCanvas } from "./helpers";

/** Switch the pane to the canvas view (the harness's view toggle). */

/** The canvas-view container (the viewport's chrome root). */

/** The world transform (the zoom / pan's stand, the style string). */
const worldTransform = async (page: Page, client: "a" | "b"): Promise<string> =>
  canvasView(page, client)
    .locator('[data-slot="docblocks/canvas-world"]')
    .evaluate((el) => el.style.transform);

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** The zoom label (the "Reset zoom" button's text). */
const zoomPercent = (page: Page, client: "a" | "b") => zoomToolbar(page, client).getByLabel("Reset zoom");

/** The zoom's numeric stand (the label's percent). */
const zoomValue = async (page: Page, client: "a" | "b"): Promise<number> =>
  Number((await zoomPercent(page, client).textContent())!.replace("%", ""));

/** The wide scattered scene: two shapes far apart (the fit's zoom-out). */
async function seedWideScene(page: Page): Promise<void> {
  await page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: 9000, y: 0, w: 100, h: 80 });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(b, { x: -9000, y: 0, w: 100, h: 80 });
    });
  });
  await expect(page.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"]`)).toHaveCount(2);
}

/** The zoom's step up (the toolbar's zoom-in — a deterministic stand change). */
async function zoomIn3(page: Page, client: "a" | "b"): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await zoomToolbar(page, client).getByLabel("Zoom in").click();
  }
}

test.describe("the canvas viewport's persistence (the localStorage's map)", () => {
  test("the first entry stands the fit (the fit's math; the clean storage's default)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-vp-fit-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await seedWideScene(page);
      await toCanvas(page, "a");

      // The entry's fit: the zoom stands the fit's stand (the zoomed-out
      // stand over the wide content — not the default's 100%).
      await expect.poll(() => zoomValue(page, "a")).toBeLessThan(100);
      const entry = await worldTransform(page, "a");

      // The manual fit stands the same (the one math — the entry's fit is
      // the fit button's stand).
      await zoomToolbar(page, "a").getByLabel("Fit to screen").click();
      const manualFit = await worldTransform(page, "a");
      expect(entry).toBe(manualFit);

      // The fit stands the view state only: the doc's data stands.
      const json = await page.evaluate(() => window.__paneDocs?.a?.toJSON());
      expect(json).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  test("the change's commit stands over the reload (the restore, not the fit)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-vp-reload-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await seedWideScene(page);
      await toCanvas(page, "a");
      await expect.poll(() => zoomValue(page, "a")).toBeLessThan(100);
      const fit = await worldTransform(page, "a");

      // The change: the zoom's step up (a stand over the fit's zoom).
      await zoomIn3(page, "a");
      const changed = await worldTransform(page, "a");
      expect(changed).not.toBe(fit);

      // The debounce's write stands committed before the reload.
      await page.waitForTimeout(500);

      await page.reload();
      await expect(page.getByTestId("status-a")).toHaveText("connected");
      await toCanvas(page, "a");
      const restored = await worldTransform(page, "a");
      expect(restored).toBe(changed);
      expect(restored).not.toBe(fit);
    } finally {
      await context.close();
    }
  });

  test("the new tab stands the restore (the shared origin's storage)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-vp-tab-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await seedWideScene(page);
      await toCanvas(page, "a");
      await expect.poll(() => zoomValue(page, "a")).toBeLessThan(100);
      const fit = await worldTransform(page, "a");
      await zoomIn3(page, "a");
      const changed = await worldTransform(page, "a");
      expect(changed).not.toBe(fit);
      await page.waitForTimeout(500);

      // The new tab (the same origin's storage): the restore stands the
      // changed stand (not the fit).
      const page2 = await context.newPage();
      await openPane(page2, "a", room);
      await toCanvas(page2, "a");
      const restored = await worldTransform(page2, "a");
      expect(restored).toBe(changed);
      expect(restored).not.toBe(fit);
    } finally {
      await context.close();
    }
  });

  test("the page/canvas switch stands the restore (the state's keep)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-vp-switch-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await seedWideScene(page);
      await toCanvas(page, "a");
      await expect.poll(() => zoomValue(page, "a")).toBeLessThan(100);
      const fit = await worldTransform(page, "a");
      await zoomIn3(page, "a");
      const changed = await worldTransform(page, "a");
      expect(changed).not.toBe(fit);
      await page.waitForTimeout(500);

      // The page switch (the canvas view's unmount) + the canvas's return
      // (the restore stands the changed stand).
      await switchPaneView(page, "a", "page");
      await toCanvas(page, "a");
      const restored = await worldTransform(page, "a");
      expect(restored).toBe(changed);
      expect(restored).not.toBe(fit);
    } finally {
      await context.close();
    }
  });
});
