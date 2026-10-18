import { type Browser, type Page, expect, test } from "@playwright/test";

// The shape's color toolbar (the single `shape` selection): the fill and
// the stroke applies (the palette swatch, the none entry, the custom hex)
// reach the doc on both panes (one updateBlock per apply) and the svg's
// paint attributes stand; the multi selection hides the toolbar.
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

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

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function shapeAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ fill?: string; stroke?: string } | undefined> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return undefined;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "shape") return undefined;
      // The harness `PaneBlock` carries the attrs as a loose record — the
      // shape fill/stroke are hex strings (or the literal `none`).
      return {
        fill: block.attrs?.fill as string | undefined,
        stroke: block.attrs?.stroke as string | undefined,
      };
    },
    { client, id }
  );
}

async function seedShape(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(id, { x: 0, y: 0, w: 200, h: 100 });
      return id;
    },
    { client }
  );
}

/** Click the shape's center (selects it; the no-op press writes nothing). */
async function selectShape(page: Page, client: "a" | "b"): Promise<void> {
  const center = await canvasCenter(page, client);
  await page.mouse.click(center.x, center.y);
}

const toolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/shape-toolbar"]');

test.describe("the shape color toolbar", () => {
  test("the fill swatch applies the fill (the svg stands; the other pane syncs)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-color-fill");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");
      expect(await toolbar(a, "a").count()).toBe(1);

      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      await a.locator('[data-slot="docblocks/shape-fill-swatch"][data-color="#3b82f6"]').click();

      expect(await shapeAttrs(a, "a", shape)).toEqual({ fill: "#3b82f6", stroke: undefined });
      await expect.poll(async () => shapeAttrs(b, "b", shape), SETTLE).toEqual({ fill: "#3b82f6", stroke: undefined });

      // The svg's paint group stands the applied fill.
      await expect(a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"] g`)).toHaveAttribute(
        "fill",
        "#3b82f6"
      );
    } finally {
      await close();
    }
  });

  test("the stroke swatch applies the stroke (the svg stands)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-color-stroke");
    try {
      await toCanvas(a, "a");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");

      await a.locator('[data-slot="docblocks/shape-toolbar-stroke"]').click();
      await a.locator('[data-slot="docblocks/shape-stroke-swatch"][data-color="#e11d48"]').click();

      expect(await shapeAttrs(a, "a", shape)).toEqual({ fill: undefined, stroke: "#e11d48" });
      await expect(a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"] g`)).toHaveAttribute(
        "stroke",
        "#e11d48"
      );
    } finally {
      await close();
    }
  });

  test("the none entry writes the literal 'none' (the svg fill is transparent)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-color-none");
    try {
      await toCanvas(a, "a");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");

      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      await a.locator('[data-slot="docblocks/shape-fill-none"]').click();

      expect(await shapeAttrs(a, "a", shape)).toEqual({ fill: "none", stroke: undefined });
      await expect(a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"] g`)).toHaveAttribute(
        "fill",
        "none"
      );
    } finally {
      await close();
    }
  });

  test("the custom hex applies on Enter (the other pane syncs); the invalid draft is ignored", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-color-hex");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");

      // The sections are mutually exclusive: the non-modal popover does
      // not close on an outside click, so the fill palette stands open
      // until the toolbar's own state closes it — the stroke trigger's
      // open must close the fill (a per-section state would let both
      // palettes stand at once).
      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      expect(await a.locator('[data-slot="docblocks/shape-fill-palette"]').count()).toBe(1);
      await a.locator('[data-slot="docblocks/shape-toolbar-stroke"]').click();
      expect(await a.locator('[data-slot="docblocks/shape-fill-palette"]').count()).toBe(0);
      expect(await a.locator('[data-slot="docblocks/shape-stroke-palette"]').count()).toBe(1);

      // The invalid draft: no apply (the value stands absent). A real
      // mouse click focuses the input (the toolbar wrapper's mousedown
      // guard must not swallow the portaled input's focus transfer). The
      // reopened fill starts with an empty draft (the section switch
      // closed it — the draft is the open popover's state).
      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      const hex = a.locator('[data-slot="docblocks/shape-fill-hex"]');
      await hex.click();
      expect(await hex.evaluate((el) => document.activeElement === el)).toBe(true);
      expect(await hex.inputValue()).toBe("");
      await hex.fill("zzz");
      await hex.press("Enter");
      expect(await shapeAttrs(a, "a", shape)).toEqual({ fill: undefined, stroke: undefined });

      // The valid draft applies (the other pane picks it up).
      await hex.fill("#0f172a");
      await hex.press("Enter");
      expect(await shapeAttrs(a, "a", shape)).toEqual({ fill: "#0f172a", stroke: undefined });
      await expect.poll(async () => shapeAttrs(b, "b", shape), SETTLE).toEqual({ fill: "#0f172a", stroke: undefined });
    } finally {
      await close();
    }
  });

  test("the multi selection hides the toolbar (the marquee group)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-color-multi");
    try {
      await toCanvas(a, "a");

      // Zoom out to 25% (the canvas-move pattern): the page miniature
      // shrinks and the empty canvas around the seeded shapes stands
      // free, so the marquee starts inside the container but off the
      // page card (the card would catch the press as its move).
      const zoom = canvasView(a, "a").getByRole("toolbar", { name: "Canvas zoom" });
      for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
      expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");

      const [s1, s2] = await a.evaluate(() => {
        const doc = window.__paneDocs!.a!;
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const r1 = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(r1, { x: -500, y: 0, w: 120, h: 80 });
        const r2 = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
        doc.setGeometry(r2, { x: 500, y: 0, w: 120, h: 80 });
        return [r1, r2];
      });

      const center = await canvasCenter(a, "a");
      // The marquee crosses both shapes (the canvas ±500 stands at the
      // screen ±125 at the 25% zoom).
      await a.mouse.move(center.x - 170, center.y - 70);
      await a.mouse.down();
      await a.mouse.move(center.x, center.y, { steps: 3 });
      await a.mouse.move(center.x + 170, center.y + 70, { steps: 3 });
      await a.mouse.up();

      const selected = await canvasView(a, "a")
        .locator('[data-slot="docblocks/canvas-item"][data-selected]')
        .evaluateAll((els) => els.map((el) => el.dataset.blockId ?? ""));
      expect(selected.sort()).toEqual([s1, s2].sort());
      expect(await toolbar(a, "a").count()).toBe(0);
    } finally {
      await close();
    }
  });

  test("keys from the portaled palette (the input, the content focus) never delete the selection", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-color-hex-keys");
    try {
      await toCanvas(a, "a");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");

      await a.locator('[data-slot="docblocks/shape-toolbar-fill"]').click();
      const hex = a.locator('[data-slot="docblocks/shape-fill-hex"]');

      // The input stands portaled in the document body (outside the
      // editor root). A Backspace / Delete on it must not reach the
      // editor root's key handling: with the blocks selection live,
      // those keys would remove the selected blocks.
      await hex.press("Backspace");
      await hex.press("Delete");

      // The input keys are guarded: the shape and its selection stand.
      expect(await toolbar(a, "a").count()).toBe(1);

      // The radix content div is focusable (tabIndex -1): a real press on
      // its padding would stand the focus there. The palette's mousedown
      // guard suppresses the focus transfer (a key on that focus would
      // delete the selection — neither key guard covers a plain div).
      const palette = a.locator('[data-slot="docblocks/shape-fill-palette"]');
      await palette.click({ position: { x: 4, y: 4 } });
      const active = await a.evaluate(() => document.activeElement?.getAttribute("data-slot") ?? null);
      expect(active).not.toBe("docblocks/shape-fill-palette");

      // The backstop: even a programmatic focus on the content div (the
      // tabIndex -1 allows it) must not delete the shape (the canvas
      // container's key handler runs the DOM-containment guard; the root
      // handler's removeBlocksSelection skips the shape — it is no
      // page-sequence member).
      await a.evaluate(() => {
        (document.querySelector('[data-slot="docblocks/shape-fill-palette"]') as HTMLElement).focus();
      });
      await a.keyboard.press("Backspace");
      await a.keyboard.press("Delete");

      const alive = await a.evaluate((id) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        return doc.getBlock(id) !== null;
      }, shape);
      expect(alive).toBe(true);
    } finally {
      await close();
    }
  });

  test("the type picker switches the variant (the figure re-renders; the other pane syncs)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-variant-switch");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const shape = await seedShape(a, "a");
      await selectShape(a, "a");
      expect(await toolbar(a, "a").count()).toBe(1);

      await a.locator('[data-slot="docblocks/shape-toolbar-variant"]').click();
      const menu = a.locator('[aria-label="Shape types"]');
      await expect(menu).toBeVisible();
      await expect
        .poll(async () => menu.locator('[data-variant="rect"]').getAttribute("aria-checked"), SETTLE)
        .toBe("true");

      await menu.locator('[data-variant="diamond"]').click();
      const attrs = await a.evaluate((id) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const block = doc.getBlock(id);
        return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
      }, shape);
      expect(attrs).toBe("diamond");

      // The figure re-renders: the rect figure is gone, the polygon stands.
      const svg = a.locator(`[data-slot="docblocks/shape"][data-block-id="${shape}"]`);
      expect(await svg.locator("rect").count()).toBe(0);
      expect(await svg.locator("polygon").count()).toBe(1);

      // One undo step reverts the switch (the focus stands on the canvas
      // container from the select press).
      await a.keyboard.press("Control+z");
      await expect
        .poll(
          async () =>
            a.evaluate((id) => {
              const doc = window.__paneDocs?.a;
              if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
              const block = doc.getBlock(id);
              return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
            }, shape),
          SETTLE
        )
        .toBe("rect");

      // The switch synced to the other pane before the undo; the undo
      // syncs back.
      await expect
        .poll(
          async () =>
            b.evaluate((id) => {
              const doc = window.__paneDocs?.b;
              if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
              const block = doc.getBlock(id);
              return block?.type === "shape" ? (block.attrs?.variant as string | undefined) : undefined;
            }, shape),
          SETTLE
        )
        .toBe("rect");
    } finally {
      await close();
    }
  });
});
