// The page miniature over the canvas: the two-click entry (the first click
// selects the card with no caret, the second stands the caret), the drag
// commits the root's geometry (the default page box), the scrollbar strip's
// press stands no page move, and the move drag stands no native text
// selection. Every test zooms out to 25% so the page miniature shrinks and
// the empty canvas around it stands free.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, blockShapes, canvasCenter, canvasView, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

/** Zoom the pane out to 25% (four steps down from 100%). */
async function zoomTo25(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");
}

/** The selected canvas item ids on the pane. */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-selected]`)
    .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
}

/** The pane's doc root id. */
async function rootId(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      return doc.meta.id;
    },
    { client }
  );
}

test.describe("the two-click contract (the editor over the canvas)", () => {
  test("the first click over the page text selects the card (no caret); the second stands the caret", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-page-card-2click");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo25(a, "a");

      // Seed a deterministic paragraph and target it by block id (the
      // room doc's starter content stands too).
      const pid = await a.evaluate(() => {
        const docs = window.__paneDocs;
        const doc = docs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const p = doc.insertBlock("paragraph");
        doc.insertText(p, 0, "two-click");
        return p;
      });
      expect(pid).toBeTruthy();
      const text = a.locator(
        `[data-testid="doc-a"] [data-slot="docblocks/page-card"] [data-block-id="${pid}"] [data-slot="docblocks/block-content"]`
      );
      await expect(text).toBeVisible();
      const box = (await text.boundingBox())!;
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

      // The first click: the card selects (the cyan outline stands), no
      // caret (the press is prevented — the focus parks on the canvas
      // view, no text selection).
      await a.mouse.click(point.x, point.y);
      const card = a.locator('[data-testid="doc-a"] [data-slot="docblocks/page-card"]');
      expect(await card.evaluate((el) => getComputedStyle(el).outlineColor)).toBe("rgb(57, 197, 207)");
      expect(
        await a.evaluate(() => ({
          focus: document.activeElement?.getAttribute("data-slot") ?? null,
          editable: (document.activeElement as HTMLElement | null)?.isContentEditable ?? false,
          ranges: window.getSelection()?.rangeCount ?? 0,
        }))
      ).toEqual({ focus: "docblocks/canvas-view", editable: false, ranges: 0 });

      // The second click: the caret stands (the card is already
      // selected) and the typing path works.
      await a.mouse.click(point.x, point.y);
      const caret = await a.evaluate(() => (document.activeElement as HTMLElement | null)?.isContentEditable ?? false);
      expect(caret).toBe(true);
      await a.keyboard.press("End");
      await a.keyboard.type("42");
      await expect
        .poll(
          async () =>
            a.evaluate(
              ({ id }) => {
                const block = window.__paneDocs?.a?.getBlock(id) as
                  { type: string; content?: { text: string }[] } | null | undefined;
                if (block === null || block === undefined || block.type !== "paragraph") return null;
                return (block.content ?? []).map((r) => r.text).join("");
              },
              { id: pid as string }
            ),
          SETTLE
        )
        .toContain("two-click42");
      // The edit reaches the other pane over the wire.
      await expect
        .poll(
          async () =>
            b.evaluate(
              ({ id }) => {
                const block = window.__paneDocs?.b?.getBlock(id) as
                  { type: string; content?: { text: string }[] } | null | undefined;
                if (block === null || block === undefined || block.type !== "paragraph") return null;
                return (block.content ?? []).map((r) => r.text).join("");
              },
              { id: pid as string }
            ),
          SETTLE
        )
        .toContain("two-click42");
    } finally {
      await close();
    }
  });
});

test.describe("the canvas move session", () => {
  test("a pointer drag moves the page miniature (the root's geometry, the default page box)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-move-page");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo25(a, "a");
      expect((await blockShapes(a, "a"))[await rootId(a, "a")]?.geometry).toBeUndefined();

      // The card at 25% stands at the (±90, ±120) center box; the press
      // lands on the card's bottom padding (non-contenteditable) and drags
      // the miniature.
      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x, center.y + 100);
      await a.mouse.down();
      await a.mouse.move(center.x + 20, center.y + 110, { steps: 6 });
      await a.mouse.up();

      // The screen delta (20, 10) is the canvas delta (80, 40) at 25%; the
      // effective box is the default page size.
      const root = await rootId(a, "a");
      expect((await blockShapes(a, "a"))[root]?.geometry).toEqual({ x: 80, y: 40, w: 720, h: 960 });
      await expect
        .poll(async () => (await blockShapes(b, "b"))[root]?.geometry, SETTLE)
        .toEqual({ x: 80, y: 40, w: 720, h: 960 });
    } finally {
      await close();
    }
  });

  test("a press on the card's scrollbar strip does not start a page move (the overflowing card)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-scrollstrip");
    try {
      await toCanvas(a, "a");
      // A tall page: the card's content overflows (the native thin
      // scrollbar stands).
      await a.evaluate((client) => {
        const docs = window.__paneDocs;
        const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        doc.transact(() => {
          for (let i = 0; i < 40; i += 1) {
            const id = doc.insertBlock("paragraph");
            doc.insertText(id, 0, `row ${i}`);
          }
        });
      }, "a");
      const zoom = zoomToolbar(a, "a");
      await zoom.getByLabel("Zoom out").click(); // 75%
      await zoom.getByLabel("Zoom out").click(); // 50%: the card stands at the (±180, ±240) box

      const card = a.locator('[data-testid="doc-a"] [data-slot="docblocks/page-card"]');
      expect(await card.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

      const box = (await canvasView(a, "a").boundingBox())!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      const right = await card.evaluate((el) => el.getBoundingClientRect().right);

      // The press stands in the strip (12px of the card's right edge) —
      // the target is the card's scroll element, not a row.
      await a.mouse.move(right - 4, center.y);
      await a.mouse.down();
      await a.mouse.move(right - 4 + 30, center.y + 15, { steps: 6 });
      await a.mouse.up();

      // No page move was committed: the root stands geometry-less (the
      // strip belongs to the native scrollbar drag).
      expect((await blockShapes(a, "a"))[await rootId(a, "a")]?.geometry).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("the move drag over the page card stands no native text selection", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-noselection");
    try {
      await toCanvas(a, "a");
      await zoomTo25(a, "a");

      // The page carries text (the page card's editable content under the
      // pointer) and a texted shape stands over the page card (the canvas
      // center = the card's center — the surface paints after the card, so
      // the shape stands over it).
      await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        doc.transact(() => {
          const p = doc.insertBlock("paragraph");
          doc.insertText(p, 0, "page text under the shape");
        });
      });
      const shape = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const id = doc.insertBlock("shape", { variant: "rect", text: "draggable" }, { parent: surface });
        doc.setGeometry(id, { x: 0, y: 0, w: 120, h: 80 });
        return id;
      });

      const center = await canvasCenter(a, "a");
      // The press on the shape (it stands over the page card): the shape
      // selects, not the card.
      await a.mouse.click(center.x, center.y);
      expect(await selectedIds(a, "a")).toEqual([shape]);

      const selText = () => a.evaluate(() => window.getSelection()?.toString() ?? "");

      // The sideways move drag: the pointer runs over the page card's
      // editable content (and the shape's own text). The native text
      // selection must stand none (the press is prevented — no caret /
      // selection on the content under the pointer).
      await a.mouse.move(center.x, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x + 60, center.y, { steps: 6 });
      expect(await selText()).toBe("");
      await a.mouse.up();
      expect(await selText()).toBe("");

      // The move still commits (the screen delta 60 is the canvas delta
      // 240 at 25%).
      expect((await blockShapes(a, "a"))[shape]?.geometry?.x).toBe(240);
    } finally {
      await close();
    }
  });
});
