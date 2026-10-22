import { type Browser, type Page, expect, test } from "@playwright/test";

// The canvas move session (the pointer drag over a canvas item): the press
// selects (group-aware), the drag previews and commits one setGeometry
// per item in one transact on release (one undo step), and a no-op press
// writes nothing. Every test zooms out to 25% so the page miniature
// shrinks and the empty canvas around the seeded shapes stands free.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };
const ZOOM = 0.25;

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await page.getByTestId(`view-${client}-canvas`).click();
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The pane's doc JSON blocks (the geometry per id). */
async function blockShapes(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<
        string,
        { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }
      > = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as { type: string; geometry?: { x: number; y: number; w: number; h: number } };
        out[id] = { type: entry.type, geometry: entry.geometry };
      }
      return out;
    },
    { client }
  );
}

/** Seed one canvas shape on the pane's doc (the first surface, created when absent). */
async function seedShape(
  page: Page,
  client: "a" | "b",
  variant: "rect" | "rounded" | "ellipse" | "diamond",
  geometry: { x: number; y: number; w: number; h: number }
): Promise<string> {
  return page.evaluate(
    ({ client, variant, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", { variant }, { parent: surface });
      doc.setGeometry(id, geometry);
      return id;
    },
    { client, variant, geometry }
  );
}

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

  test("the marquee skips the connector (its wrapper is an empty box); the group moves without it", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-connector");
    try {
      await toCanvas(a, "a");
      const s1 = await seedShape(a, "a", "rect", { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", "ellipse", { x: 500, y: 0, w: 120, h: 80 });
      const connector = await a.evaluate(
        ({ client, s1, s2 }) => {
          const docs = window.__paneDocs;
          const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          const json = doc.toJSON();
          const surface = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
          if (surface === undefined) throw new Error("no surface");
          return doc.insertBlock("connector", { start: { blockId: s1 }, end: { blockId: s2 } }, { parent: surface });
        },
        { client: "a" as const, s1, s2 }
      );
      await zoomTo25(a, "a");
      const center = await canvasCenter(a, "a");

      // The marquee crosses the center (the connector's phantom box) — the
      // connector is not selectable (no own box).
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();
      expect((await selectedIds(a, "a")).sort()).toEqual([s1, s2].sort());

      // The drag moves the two shapes; the connector keeps no geometry.
      await a.mouse.move(center.x - 500 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x - 500 * ZOOM + 40, center.y + 20, { steps: 8 });
      await a.mouse.up();

      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry?.x).toBe(-340);
      expect(shapes[s2]?.geometry?.x).toBe(660);
      expect(shapes[connector]?.geometry).toBeUndefined();
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

  test("a pointer drag moves the shape (one setGeometry; the peer syncs)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-move-single");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", "rect", { x: 300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");

      // The item's screen center: the canvas center + the canvas position
      // scaled by the zoom (the pan is 0).
      const center = await canvasCenter(a, "a");
      const start = { x: center.x + 300 * ZOOM, y: center.y + 0 };

      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 30, start.y - 15, { steps: 8 });
      await a.mouse.up();

      // The screen delta (30, -15) is the canvas delta (120, -60) at 25%.
      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry).toEqual({ x: 420, y: -60, w: 120, h: 80 });
      await expect
        .poll(async () => (await blockShapes(b, "b"))[s1]?.geometry, SETTLE)
        .toEqual({ x: 420, y: -60, w: 120, h: 80 });

      // One undo step reverts the move (the focus parked on the canvas
      // container at the press).
      expect(await a.evaluate(() => document.activeElement?.getAttribute("data-slot"))).toBe("docblocks/canvas-view");
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => (await blockShapes(a, "a"))[s1]?.geometry, SETTLE)
        .toEqual({ x: 300, y: 0, w: 120, h: 80 });
    } finally {
      await close();
    }
  });

  test("a click selects the item (no drag: nothing is written)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-click");
    try {
      await toCanvas(a, "a");
      const s1 = await seedShape(a, "a", "rect", { x: 300, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", "ellipse", { x: -300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");

      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 300 * ZOOM, center.y);
      expect(await selectedIds(a, "a")).toEqual([s1]);

      // The other item stands unselected.
      await a.mouse.click(center.x - 300 * ZOOM, center.y);
      expect(await selectedIds(a, "a")).toEqual([s2]);
    } finally {
      await close();
    }
  });

  test("a no-op drag (below the threshold) writes nothing", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-move-noop");
    try {
      await toCanvas(a, "a");
      await seedShape(a, "a", "rect", { x: 300, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");
      const before = await blockShapes(a, "a");

      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x + 300 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x + 300 * ZOOM + 1, center.y + 1, { steps: 2 });
      await a.mouse.up();

      expect(await blockShapes(a, "a")).toEqual(before);
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

  test("a marquee group moves by one delta (every item in the group)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-move-group");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const s1 = await seedShape(a, "a", "rect", { x: -500, y: 0, w: 120, h: 80 });
      const s2 = await seedShape(a, "a", "ellipse", { x: 500, y: 0, w: 120, h: 80 });
      await zoomTo25(a, "a");
      const center = await canvasCenter(a, "a");

      // The marquee: an empty-canvas drag covering both shapes (the page
      // miniature shrinks to the center box at 25%).
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();
      expect((await selectedIds(a, "a")).sort()).toEqual([s1, s2].sort());

      // Drag one of the selected: the whole group moves. The screen delta
      // (40, 20) is the canvas delta (160, 80) at 25%.
      await a.mouse.move(center.x - 500 * ZOOM, center.y);
      await a.mouse.down();
      await a.mouse.move(center.x - 500 * ZOOM + 40, center.y + 20, { steps: 8 });
      await a.mouse.up();

      const shapes = await blockShapes(a, "a");
      expect(shapes[s1]?.geometry).toEqual({ x: -340, y: 80, w: 120, h: 80 });
      expect(shapes[s2]?.geometry).toEqual({ x: 660, y: 80, w: 120, h: 80 });
      await expect
        .poll(
          async () =>
            (await blockShapes(b, "b"))[s1]?.geometry?.x === -340 &&
            (await blockShapes(b, "b"))[s2]?.geometry?.x === 660,
          SETTLE
        )
        .toBe(true);
    } finally {
      await close();
    }
  });
});
