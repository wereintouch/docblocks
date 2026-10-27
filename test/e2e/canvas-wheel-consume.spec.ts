// The canvas view's wheel is consumed by the viewport (the pan / the zoom
// are the world's transform — view state, no data): every wheel path
// preventDefaults (the non-passive listener) so the wheel never chains onto
// the page / the enclosing scroll container (the overlay scrollbar's flash),
// and the viewport stands `overscroll-behavior: contain` as the chaining
// guard. The consume is canvas-only: the page view's wheel keeps scrolling.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

async function onePane(browser: Browser, room: string): Promise<{ a: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const a = await context.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  return { a, close: () => context.close() };
}

/** Force the page to be scrollable (content overflows the viewport) so the
 * wheel's default action has a scrollable target to chain onto. */
async function forceScrollablePage(page: Page): Promise<void> {
  await page.addStyleTag({ content: "main { min-height: 3000px !important; }" });
  await page.waitForTimeout(100);
}

/** Read the canvas view's computed overscroll-behavior. */
async function overscrollBehavior(page: Page): Promise<string> {
  return page.evaluate(
    () => getComputedStyle(document.querySelector('[data-slot="docblocks/canvas-view"]')!).overscrollBehavior
  );
}

/** Dispatch a synthetic wheel on the canvas view and report the handler's
 * preventDefault stand (the dispatchEvent is synchronous — the handler's
 * preventDefault stands before the read). */
async function wheelPrevented(
  page: Page,
  init: { deltaX?: number; deltaY?: number; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }
): Promise<boolean> {
  return page.evaluate((i) => {
    const target = document.querySelector('[data-slot="docblocks/canvas-view"]');
    if (target === null) return false;
    const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...i });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  }, init);
}

/** The world wrapper's transform (the pan + the zoom's carrier). */
async function worldTransform(page: Page): Promise<string> {
  return page.evaluate(
    () => (document.querySelector('[data-slot="docblocks/canvas-world"]') as HTMLElement | null)?.style.transform ?? ""
  );
}

test("the canvas view consumes the wheel (the page never scrolls; the zero-delta no-op included)", async ({
  browser,
}) => {
  const { a, close } = await onePane(browser, "canvas-wheel-consume");
  try {
    await switchPaneView(a, "a", "canvas");
    const canvas = a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').first();
    await canvas.waitFor({ state: "visible" });

    // The overscroll-behavior guard stands on the canvas view.
    await expect.poll(() => overscrollBehavior(a)).toBe("contain");

    // Consume on every path: the pan (the pointer mode's notch), the
    // zero-delta no-op (the formerly-leaking path), and the pinch
    // (ctrl+wheel). The doc stands (the wheel is the view state).
    const before = await a.evaluate(() => window.__paneDocs?.a?.toJSON() ?? null);
    expect(await wheelPrevented(a, { deltaY: 120 })).toBe(true); // the pan
    expect(await wheelPrevented(a, { deltaX: 0, deltaY: 0 })).toBe(true); // the zero-delta no-op
    expect(await wheelPrevented(a, { deltaY: -120, ctrlKey: true })).toBe(true); // the pinch
    const after = await a.evaluate(() => window.__paneDocs?.a?.toJSON() ?? null);
    expect(JSON.stringify(after)).toBe(JSON.stringify(before)); // the wheel commits no data

    // A real wheel (the pan) never scrolls the page: force a scrollable
    // page, park the scroll, wheel the canvas — the scrollTop stands.
    await forceScrollablePage(a);
    await a.evaluate(() => {
      document.scrollingElement!.scrollTop = 300;
    });
    const box = (await canvas.boundingBox())!;
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const topBefore = await a.evaluate(() => document.scrollingElement!.scrollTop);
    for (let i = 0; i < 4; i++) {
      await a.mouse.wheel(0, 120);
      await a.waitForTimeout(40);
    }
    await a.waitForTimeout(150);
    const topAfter = await a.evaluate(() => document.scrollingElement!.scrollTop);
    expect(topAfter - topBefore).toBe(0); // the page never scrolled
  } finally {
    await close();
  }
});

test("the page view's wheel keeps scrolling (the consume is canvas-only — the regression)", async ({ browser }) => {
  const { a, close } = await onePane(browser, "canvas-wheel-page");
  try {
    // The page view (the default): the page flow is scrollable.
    const pageCol = a.locator('[data-testid="doc-a"] [data-slot="docblocks/page"]').first();
    await pageCol.waitFor({ state: "visible" });
    await forceScrollablePage(a);
    const box = (await pageCol.boundingBox())!;
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await a.evaluate(() => {
      document.scrollingElement!.scrollTop = 0;
    });
    for (let i = 0; i < 5; i++) {
      await a.mouse.wheel(0, 120);
      await a.waitForTimeout(40);
    }
    await a.waitForTimeout(150);
    // The page scrolled (the wheel is NOT consumed in the page view).
    const top = await a.evaluate(() => document.scrollingElement!.scrollTop);
    expect(top).toBeGreaterThan(0);
  } finally {
    await close();
  }
});

test("the canvas pan / zoom still stand (the consume does not break the gesture — the regression)", async ({
  browser,
}) => {
  const { a, close } = await onePane(browser, "canvas-wheel-regress");
  try {
    await switchPaneView(a, "a", "canvas");
    const canvas = a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').first();
    await canvas.waitFor({ state: "visible" });
    const box = (await canvas.boundingBox())!;
    await a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // A real wheel (the pan) moves the world's transform.
    const panBefore = await worldTransform(a);
    await a.mouse.wheel(0, 120);
    await a.waitForTimeout(150);
    const panAfter = await worldTransform(a);
    expect(panAfter).not.toBe(panBefore); // the pan moved

    // A real pinch (ctrl+wheel) changes the zoom.
    await a.keyboard.down("Control");
    await a.mouse.wheel(0, -120);
    await a.waitForTimeout(150);
    await a.keyboard.up("Control");
    const zoomAfter = await worldTransform(a);
    expect(zoomAfter).not.toBe(panAfter); // the zoom moved
  } finally {
    await close();
  }
});
