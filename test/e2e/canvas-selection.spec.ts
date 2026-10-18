import { type Browser, type Page, expect, test } from "@playwright/test";

// The canvas mouse selection: the shift-click's additive toggle (the doc
// stands, the selection is view state per pane), the Escape clear, the
// shift-marquee's union, and the selection's cyan contract (the marquee's
// line only — no
// fill — and the selected item's thin outline, the shared token, the base
// cyan and the muted dark).
const RELAY = "ws://localhost:5199";

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

/** Seeds the two seeded shapes (apart) and returns their ids. */
async function seedShapes(page: Page, client: "a" | "b"): Promise<{ left: string; right: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const left = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(left, { x: -200, y: 0, w: 120, h: 80 });
      const right = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(right, { x: 200, y: 0, w: 120, h: 80 });
      return { left, right };
    },
    { client }
  );
}

/** The selected ids (the data-selected wrappers). */
async function selectedIds(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      return Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item'][data-selected]")).map(
        (el) => el.dataset.blockId as string
      );
    },
    { client }
  );
}

/** The doc's shape geometries (the no-move pin's invariant). */
async function shapeGeometries(page: Page, client: "a" | "b"): Promise<Record<string, { x: number; y: number }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const result: Record<string, { x: number; y: number }> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const loose = block as { geometry?: { x: number; y: number } };
        if (block.type === "shape" && loose.geometry !== undefined) {
          result[id] = { x: loose.geometry.x, y: loose.geometry.y };
        }
      }
      return result;
    },
    { client }
  );
}

const zoomToolbar = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Zoom" });

/** The screen center of a canvas item (the wrapper's box). */
async function itemCenter(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  const box = (await page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`)
    .boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("the canvas mouse selection", () => {
  test("the shift-click toggles the additive selection (the doc stands, the other pane is untouched)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-sel-shift");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      await b.waitForTimeout(500); // the other pane's sync settle

      // The plain click selects left alone.
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);

      // The shift-click adds right (Miro's additive select; no move).
      const cR = await itemCenter(a, "a", right);
      await a.keyboard.down("Shift");
      await a.mouse.click(cR.x, cR.y);
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());
      // The doc stands (the selection is view state — no wire traffic).
      expect(await shapeGeometries(a, "a")).toEqual({
        [left]: { x: -200, y: 0 },
        [right]: { x: 200, y: 0 },
      });
      // The other pane's selection stands empty (the per-pane view state).
      expect(await selectedIds(b, "b")).toEqual([]);

      // The shift-click removes left (the toggle back).
      await a.keyboard.down("Shift");
      await a.mouse.click(cL.x, cL.y);
      await a.keyboard.up("Shift");
      expect(await selectedIds(a, "a")).toEqual([right]);
    } finally {
      await close();
    }
  });

  test("the Escape clears the standing selection (the mid-move variant stands the selection)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-escape");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");

      // The plain clear: the click select, the Escape (the editor root's
      // blocks-selection path — the container's cancels stand before it).
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);
      await a.keyboard.press("Escape");
      expect(await selectedIds(a, "a")).toEqual([]);

      // The mid-move variant: the in-flight move's cancel stands first —
      // the preview drops, the selection STANDS, and the release writes
      // nothing.
      await a.mouse.move(cL.x, cL.y);
      await a.mouse.down();
      await a.mouse.move(cL.x + 30, cL.y + 20, { steps: 4 });
      await a.keyboard.press("Escape");
      expect(await selectedIds(a, "a")).toEqual([left]);
      await a.mouse.up();
      expect(await shapeGeometries(a, "a")).toEqual({
        [left]: { x: -200, y: 0 },
        [right]: { x: 200, y: 0 },
      });
    } finally {
      await close();
    }
  });

  test("the shift-marquee unions with the standing selection", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-marquee");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      // The 25% zoom (the page miniature stands small — the marquee's
      // start point stands off the card, the shapes stand near the center).
      for (let i = 0; i < 3; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      await a.waitForTimeout(300);

      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);
      expect(await selectedIds(a, "a")).toEqual([left]);

      // The shift-held marquee over the right shape only: the union stands
      // both (a replace would stand right alone). The drag stands off the
      // page miniature (the 25% card spans ±90x120 screen px) and sweeps
      // the right shape's box.
      const cR = await itemCenter(a, "a", right);
      await a.keyboard.down("Shift");
      await a.mouse.move(cR.x + 150, cR.y - 150);
      await a.mouse.down();
      await a.mouse.move(cR.x, cR.y + 80, { steps: 6 });
      await a.mouse.up();
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());

      // The additive press without a drag keeps the selection (the plain
      // press would clear it): the shift click stands off the card (the
      // empty canvas — the card's shift press stands no move, no clear).
      const center = await canvasCenter(a, "a");
      await a.keyboard.down("Shift");
      await a.mouse.click(center.x + 200, center.y + 200);
      await a.keyboard.up("Shift");
      expect((await selectedIds(a, "a")).sort()).toEqual([left, right].sort());
    } finally {
      await close();
    }
  });

  test("the selection's cyan contract (the marquee's line only, the item's outline, light + dark)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-cyan");
    try {
      await toCanvas(a, "a");
      const { left } = await seedShapes(a, "a");
      const cL = await itemCenter(a, "a", left);
      await a.mouse.click(cL.x, cL.y);

      // The dark pane (the harness default): the selected item's outline
      // reads the token (the muted dark cyan) at the 1px solid line.
      const outline = await a.evaluate(
        ({ client, id }) => {
          const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
          if (view === null) return null;
          const wrapper = view.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
          if (wrapper === null) return null;
          const style = getComputedStyle(wrapper);
          const editor = view.closest('[data-slot="docblocks/editor"]');
          const token =
            editor === null
              ? ""
              : getComputedStyle(editor).getPropertyValue("--docblocks-canvas-selection-border-color").trim();
          return {
            color: style.outlineColor,
            width: style.outlineWidth,
            style_: style.outlineStyle,
            token,
          };
        },
        { client: "a", id: left }
      );
      expect(outline).not.toBeNull();
      expect(outline!.width).toBe("1px");
      expect(outline!.style_).toBe("solid");
      // The token's dark value (the muted cyan) and the outline's color.
      expect(outline!.token).toBe("#39c5cf");
      expect(outline!.color).toBe("rgb(57, 197, 207)");

      // The selection's handles stand the accent too (the same cyan
      // token's fill, the theme's thin border).
      const handle = await a.evaluate((client) => {
        const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
        if (view === null) return null;
        const el = view.querySelector<HTMLElement>('[data-slot="docblocks/canvas-handle"][data-handle="n"]');
        if (el === null) return null;
        const style = getComputedStyle(el);
        return { background: style.backgroundColor, border: style.borderTopColor };
      }, "a");
      expect(handle).not.toBeNull();
      expect(handle!.background).toBe("rgb(57, 197, 207)");
      // The border reads the standard token seed's dark value (the
      // shipped utility layer carries it; the harness defines no theme).
      expect(handle!.border).toBe("oklch(1 0 0 / 0.1)");

      // The marquee's line + fill (the in-flight drag): the token's
      // border, the 50% fill (the same cyan). The 25% zoom stands the drag
      // off the page miniature (the start point would stand on the card
      // otherwise).
      for (let i = 0; i < 3; i += 1) await zoomToolbar(a, "a").getByLabel("Zoom out").click();
      await a.waitForTimeout(300);
      const center = await canvasCenter(a, "a");
      await a.mouse.move(center.x + 120, center.y - 100);
      await a.mouse.down();
      await a.mouse.move(center.x + 220, center.y + 40, { steps: 4 });
      const marquee = await a.evaluate(
        ({ client }) => {
          const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
          if (view === null) return null;
          const rect = view.querySelector<HTMLElement>("[data-slot='docblocks/canvas-marquee']");
          if (rect === null) return null;
          const style = getComputedStyle(rect);
          return { border: style.borderColor, width: style.borderWidth, background: style.backgroundColor };
        },
        { client: "a" }
      );
      await a.mouse.up();
      expect(marquee).not.toBeNull();
      expect(marquee!.width).toBe("1px");
      expect(marquee!.border).toBe("rgb(57, 197, 207)");
      // The 50% fill resolves to the srgb color space (the color-mix).
      expect(marquee!.background).toBe("color(srgb 0.223529 0.772549 0.811765 / 0.5)");

      // The light flip (the base cyan): the token recomputes.
      await a.evaluate(() => document.documentElement.classList.remove("dark"));
      await a.waitForTimeout(200);
      const lightToken = await a.evaluate(() => {
        const editor =
          document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/editor"]') ?? document.documentElement;
        return getComputedStyle(editor).getPropertyValue("--docblocks-canvas-selection-border-color").trim();
      });
      expect(lightToken).toBe("#0891b2");
    } finally {
      await close();
    }
  });

  test("the multi-selection's summary box (the union + the 4px offset, the cyan tokens)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "cvs-sel-multi");
    try {
      await toCanvas(a, "a");
      const { left, right } = await seedShapes(a, "a");
      const cL = await itemCenter(a, "a", left);
      const cR = await itemCenter(a, "a", right);
      await a.mouse.click(cL.x, cL.y);
      await a.keyboard.down("Shift");
      await a.mouse.click(cR.x, cR.y);
      await a.keyboard.up("Shift");

      // The box: the union of the two shapes' boxes + the 4px offset
      // (the on-screen px — 8px total per side).
      const box = await a.evaluate(
        ({ ids }) => {
          const sel = document.querySelector('[data-slot="docblocks/canvas-multi-selection"]');
          if (sel === null) return null;
          const items = ids
            .map((id) => document.querySelector(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`))
            .filter((el): el is HTMLElement => el !== null);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (const el of items) {
            const r = el.getBoundingClientRect();
            minX = Math.min(minX, r.left);
            minY = Math.min(minY, r.top);
            maxX = Math.max(maxX, r.right);
            maxY = Math.max(maxY, r.bottom);
          }
          const style = getComputedStyle(sel);
          return {
            left: sel.getBoundingClientRect().left,
            top: sel.getBoundingClientRect().top,
            width: sel.getBoundingClientRect().width,
            height: sel.getBoundingClientRect().height,
            union: { minX, minY, maxX, maxY },
            border: style.borderColor,
            background: style.backgroundColor,
          };
        },
        { ids: [left, right] }
      );
      expect(box).not.toBeNull();
      const OFF = 4;
      expect(box!.left).toBeCloseTo(box!.union.minX - OFF, 5);
      expect(box!.top).toBeCloseTo(box!.union.minY - OFF, 5);
      expect(box!.width).toBeCloseTo(box!.union.maxX - box!.union.minX + 2 * OFF, 5);
      expect(box!.height).toBeCloseTo(box!.union.maxY - box!.union.minY + 2 * OFF, 5);
      // The cyan contract (the dark pane): the border token + the 50% fill.
      expect(box!.border).toBe("rgb(57, 197, 207)");
      expect(box!.background).toBe("color(srgb 0.223529 0.772549 0.811765 / 0.5)");
    } finally {
      await close();
    }
  });
});
