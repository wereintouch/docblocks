// The canvas empty-area double-click (the canvas-text's ghost entry):
// a double-click over the empty canvas (the default mode with no active
// tool; no item / page card / line / title chip under the point) stands
// the GHOST text block — the focused contenteditable at the point (the
// world's space, the text tool's default box) with the blinking caret —
// and writes NOTHING (the ghost is view state: the doc's JSON stands, no
// block stands, no selection stands, no wire update stands). The first
// input commits the block in ONE transact (the insert + the geometry —
// the default box's top-left anchor at the point — + the text): the
// ghost closes and the caret seats into the real block at the text's END
// (the fast typing's continuation appends over the committed stand). The
// Escape over the empty ghost cancels: nothing is written.
// The page miniature's blank body keeps its own stand (the dblclick
// clears the selection and stands no ghost — the ghost's guards exclude
// the card; the card's content keeps the page's two-click contract).
import { type Page, expect, test } from "@playwright/test";

import { canvasCenter, canvasView, openPane, screenAtZoom, SETTLE, toCanvas, twoPanes, outCount } from "./helpers";

/** The zoom toolbar (scoped to the pane's canvas view). */
const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** Step the zoom out to 50% (the 10% steps) and return the factor. */
async function zoomOut50(page: Page, client: "a" | "b"): Promise<number> {
  const toolbar = zoomToolbar(page, client);
  for (let i = 0; i < 5; i += 1) {
    await toolbar.getByLabel("Zoom out").click();
  }
  const label = (await toolbar.getByLabel("Reset zoom").textContent()) ?? "50%";
  return parseInt(label, 10) / 100;
}

/** The pane's doc's JSON (the no-write invariant's read). */
async function docJson(page: Page, client: "a" | "b") {
  return page.evaluate(({ client }) => {
    const docs = window.__paneDocs;
    const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
    return doc === null ? null : doc.toJSON();
  }, { client });
}

/** The selection's stand: the selected canvas items + the handles' count. */
async function selectionStand(page: Page, client: "a" | "b"): Promise<{ items: number; handles: number }> {
  return page.evaluate(
    ({ client }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      const items = view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]").length;
      const handles = view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-handle']").length;
      return { items, handles };
    },
    { client }
  );
}

/** The ghost's stand (the wrapper's box + the focused inner's parity). */
async function ghostStand(page: Page): Promise<{ count: number; focused: boolean; box: { x: number; y: number; w: number; h: number } | null }> {
  return page.evaluate(() => {
    const ghost = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost"]');
    const inner = document.querySelector<HTMLElement>('[data-slot="docblocks/canvas-text-ghost-inner"]');
    const box = ghost?.getBoundingClientRect();
    return {
      count: ghost === null ? 0 : 1,
      focused: inner !== null && document.activeElement === inner,
      box: box === undefined ? null : { x: box.x, y: box.y, w: box.width, h: box.height },
    };
  });
}

test.describe("the canvas empty-area double-click (the ghost text block's entry)", () => {
  test("stands the ghost (the focused contenteditable at the point); nothing is written, no selection stands", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-ghost-stand");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The 50% zoom: the page card's screen half-span stands 180x240 (the
      // 720x960 world's card), so the world's (±450, ±300) — outside the
      // card and every item — stands inside the view's visible area.
      const zoom = await zoomOut50(a, "a");
      const center = await canvasCenter(a, "a");
      const jsonBefore = await docJson(a, "a");
      const outBefore = await outCount(a, "a");
      const point = screenAtZoom(center, 450, 300, zoom);

      await a.mouse.dblclick(point.x, point.y);

      // The ghost stands at the point (the world's space: the text tool's
      // default box scaled by the zoom, the top-left anchor at the point).
      const ghost = await ghostStand(a);
      expect(ghost.count).toBe(1);
      expect(ghost.focused).toBe(true);
      expect(ghost.box?.w).toBeCloseTo(200 * zoom, 1);
      expect(ghost.box?.h).toBeCloseTo(40 * zoom, 1);
      expect(ghost.box?.x).toBeCloseTo(point.x, 1);
      expect(ghost.box?.y).toBeCloseTo(point.y, 1);

      // Nothing is written (the ghost is view state): the doc's JSON stands
      // (no new block), no selection stands, no wire update stands — and
      // pane B's JSON stands over the wire.
      expect(await docJson(a, "a")).toEqual(jsonBefore);
      expect(await selectionStand(a, "a")).toEqual({ items: 0, handles: 0 });
      expect(await outCount(a, "a")).toBe(outBefore);
      expect(await docJson(b, "b")).toEqual(jsonBefore);
    } finally {
      await close();
    }
  });

  test("the first input commits the block over the wire (the geometry's top-left anchor at the point, the text); the ghost closes, the caret seats into the real block", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-ghost-commit");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const zoom = await zoomOut50(a, "a");
      const center = await canvasCenter(a, "a");
      const point = screenAtZoom(center, 450, 300, zoom);

      await a.mouse.dblclick(point.x, point.y);
      expect(await ghostStand(a).then((g) => g.count)).toBe(1);

      // The first input's commit (ONE transact: the insert + the geometry +
      // the text) over the fast multi-character type: the "H"'s input event
      // stands the commit, the caret re-seats at the text's END (the
      // after-frame's seat), so the continuation appends over the committed
      // stand (the type's delay stands the re-seat's frame stand).
      await a.keyboard.type("Hi there", { delay: 20 });

      // The ghost closes; the block stands with the geometry's top-left
      // anchor at the point (the default 200x40 box's center stands at the
      // point + half-box).
      expect(await ghostStand(a).then((g) => g.count)).toBe(0);
      const blocksA = await docJson(a, "a");
      const textA = Object.values(blocksA!.blocks).find((block) => block.type === "canvas-text");
      expect(textA).toBeDefined();
      expect(textA?.content?.map((run) => run.text).join("")).toBe("Hi there");
      expect(textA?.geometry).toEqual({ x: 450 + 100, y: 300 + 20, w: 200, h: 40 });

      // Pane B stands the block over the wire (the geometry + the content).
      await expect
        .poll(
          async () => {
            const blocksB = await docJson(b, "b");
            const textB = Object.values(blocksB!.blocks).find((block) => block.type === "canvas-text");
            return textB === undefined
              ? null
              : { text: textB.content?.map((run) => run.text).join(""), geometry: textB.geometry };
          },
          SETTLE
        )
        .toEqual({ text: "Hi there", geometry: { x: 550, y: 320, w: 200, h: 40 } });

      // The caret seats into the real block (the inner's focus, the block's
      // own id).
      const seat = await a.evaluate(() => {
        const active = document.activeElement;
        return {
          slot: active?.getAttribute("data-slot") ?? null,
          editable: active instanceof HTMLElement ? active.isContentEditable : false,
          blockId: active?.getAttribute("data-block-id") ?? null,
        };
      });
      expect(seat.slot).toBe("docblocks/block-content");
      expect(seat.editable).toBe(true);
      expect(seat.blockId).toBe(Object.keys(blocksA!.blocks).find((id) => blocksA!.blocks[id]!.type === "canvas-text"));
    } finally {
      await close();
    }
  });

  test("the Escape over the empty ghost cancels (the ghost closes, nothing is written)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-ghost-esc");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const zoom = await zoomOut50(a, "a");
      const center = await canvasCenter(a, "a");
      const point = screenAtZoom(center, -450, -300, zoom);
      const jsonBefore = await docJson(a, "a");
      const outBefore = await outCount(a, "a");

      await a.mouse.dblclick(point.x, point.y);
      expect(await ghostStand(a).then((g) => g.count)).toBe(1);

      // The Escape cancels: the ghost closes, nothing is written (the doc
      // stands, no wire update stands, pane B's JSON stands).
      await a.keyboard.press("Escape");
      expect(await ghostStand(a).then((g) => g.count)).toBe(0);
      expect(await docJson(a, "a")).toEqual(jsonBefore);
      expect(await outCount(a, "a")).toBe(outBefore);
      expect(await docJson(b, "b")).toEqual(jsonBefore);
    } finally {
      await close();
    }
  });

  test("the page card's blank body stands no ghost (the selection's clear, the doc's stand)", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const room = `canvas-ghost-card-${Math.random().toString(36).slice(2, 8)}`;
    try {
      await openPane(page, "a", room);
      await toCanvas(page, "a");
      await zoomOut50(page, "a");
      const jsonBefore = await docJson(page, "a");
      // The blank body: the card's center over the lower stretch (below the
      // starter paragraph — the blank body's point stands no block).
      const card = (await canvasView(page, "a").locator('[data-slot="docblocks/page-card"]').boundingBox())!;
      const px = card.x + card.width / 2;
      const py = card.y + card.height * 0.75;

      await page.mouse.dblclick(px, py);

      // The ghost's guards exclude the card: no ghost stands; the dblclick
      // clears the selection and writes nothing (the card's blank body's
      // stand — the content's contracts keep the page's two-click).
      expect(await ghostStand(page).then((g) => g.count)).toBe(0);
      expect(await selectionStand(page, "a")).toEqual({ items: 0, handles: 0 });
      expect(await docJson(page, "a")).toEqual(jsonBefore);
    } finally {
      await context.close();
    }
  });
});
