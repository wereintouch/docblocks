import { type Browser, type Page, expect, test } from "@playwright/test";

// The shape's text: the double-click's
// inline edit (the commit on the blur / the Escape, one updateBlock),
// the toolbar's text controls (the font / the color / the style / the
// size / the alignment — the texted stand only), and the rounded
// rectangle's variant (the line's removal). A/B sync over the relay.
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

/** The pane's doc's attrs of the given shape (null when absent). */
async function shapeAttrs(page: Page, client: "a" | "b", id: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      return block?.type === "shape" ? (block.attrs ?? null) : null;
    },
    { client, id }
  );
}

/** Seeds one shape with the given attrs + geometry on the pane's doc. */
async function seedShape(
  page: Page,
  client: "a" | "b",
  attrs: Record<string, unknown>,
  geometry: { x: number; y: number; w: number; h: number }
): Promise<string> {
  return page.evaluate(
    ({ client, attrs, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", attrs, { parent: surface });
      doc.setGeometry(id, geometry);
      return id;
    },
    { client, attrs, geometry }
  );
}

/** Click-selects the shape (the pointerdown on its canvas-item wrapper). */
async function selectShape(page: Page, client: "a" | "b", id: string): Promise<void> {
  const wrapper = canvasView(page, client).locator(`[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`);
  await wrapper.click();
}

test.describe("the shape's text", () => {
  test("the double-click enters the inline edit; the Escape commits the text (synced, one undo step)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-shape-text-dblclick");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedShape(a, "a", { variant: "rounded" }, { x: 0, y: 0, w: 200, h: 80 });
      await expect.poll(() => shapeAttrs(b, "b", id), SETTLE).not.toBeNull();

      const view = canvasView(a, "a");
      const target = view.locator(
        `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text-target"]`
      );
      await target.dblclick();
      const edit = view.locator(`[data-slot="docblocks/shape-text-edit"]`);
      await expect(edit).toBeVisible();

      await a.keyboard.type("Привет");
      await a.keyboard.press("Escape");
      await expect(edit).toHaveCount(0);

      expect((await shapeAttrs(a, "a", id))?.text).toBe("Привет");
      // The sync: the other pane's doc and its overlay stand the text.
      await expect.poll(() => shapeAttrs(b, "b", id), SETTLE).toMatchObject({ text: "Привет" });
      await expect(
        canvasView(b, "b").locator(
          `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text"]`
        )
      ).toHaveText("Привет");

      // One undo step (the commit is one updateBlock).
      await a.evaluate(
        ({ client }) => {
          const docs = window.__paneDocs;
          const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
          if (doc === null) throw new Error("the pane's doc is not mounted");
          doc.undo();
        },
        { client: "a" }
      );
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).not.toMatchObject({ text: "Привет" });
    } finally {
      await close();
    }
  });

  test("the toolbar's add-text button and the texted stand's controls (the font / the color / the style / the size / the alignment)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-shape-text-toolbar");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const id = await seedShape(a, "a", { variant: "rounded" }, { x: 0, y: 0, w: 200, h: 80 });
      await selectShape(a, "a", id);

      const view = canvasView(a, "a");
      const toolbar = view.locator('[data-slot="docblocks/shape-toolbar"]');
      await expect(toolbar).toBeVisible();

      // The textless stand: the add-text button stands, the text controls do not.
      const addText = toolbar.locator('[data-slot="docblocks/shape-toolbar-add-text"]');
      await expect(addText).toBeVisible();
      expect(await toolbar.locator('[data-slot="docblocks/shape-toolbar-font-family"]').count()).toBe(0);
      expect(await toolbar.locator('[data-slot="docblocks/shape-toolbar-font-size"]').count()).toBe(0);

      // The add-text enters the inline edit (like the double-click).
      await addText.click();
      const edit = view.locator("[data-slot='docblocks/shape-text-edit']");
      await expect(edit).toBeVisible();
      await a.keyboard.type("Текст");
      await a.keyboard.press("Escape");
      await expect(edit).toHaveCount(0);
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ text: "Текст" });

      // The texted stand: the text controls stand, the add-text goes away.
      await expect(addText).toHaveCount(0);
      const fontFamily = toolbar.locator('[data-slot="docblocks/shape-toolbar-font-family"]');
      const fontSize = toolbar.locator('[data-slot="docblocks/shape-toolbar-font-size"]');
      await expect(fontFamily).toBeVisible();
      await expect(fontSize).toBeVisible();

      // The font family (the self-hosted set's picker).
      await fontFamily.click();
      await a.getByRole("menuitemcheckbox", { name: "PT Serif" }).click();
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ fontFamily: "PT Serif" });
      await expect.poll(() => shapeAttrs(b, "b", id), SETTLE).toMatchObject({ fontFamily: "PT Serif" });

      // The text color (the palette's swatch — the fill/stroke palette).
      const textColor = toolbar.locator('[data-slot="docblocks/shape-toolbar-text"]');
      await textColor.click();
      const palette = a.locator('[data-slot="docblocks/shape-text-palette"]');
      await palette.locator('[data-slot="docblocks/shape-text-swatch"]').first().click();
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ textColor: "#71717a" });

      // The text style (the weight x the slant).
      const textStyle = toolbar.locator('[data-slot="docblocks/shape-toolbar-text-style"]');
      await textStyle.click();
      await a.getByRole("menuitemcheckbox", { name: "Light Italic" }).click();
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ textStyle: "light-italic" });

      // The font size (the numeric field: the typed value, the Enter commit).
      await fontSize.fill("48");
      await fontSize.press("Enter");
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ fontSize: 48 });

      // The alignment.
      await toolbar.locator('[data-slot="docblocks/shape-toolbar-align-right"]').click();
      await expect.poll(() => shapeAttrs(a, "a", id), SETTLE).toMatchObject({ textAlign: "right" });

      // The full attr set on the other pane (the wire's delivery).
      await expect
        .poll(() => shapeAttrs(b, "b", id), SETTLE)
        .toMatchObject({
          text: "Текст",
          fontFamily: "PT Serif",
          textColor: "#71717a",
          textStyle: "light-italic",
          fontSize: 48,
          textAlign: "right",
        });

      // The overlay's inline stand (the data, not theme): the font stack,
      // the 300 weight, the italic slant, the 48px, the right alignment.
      const target = view.locator(
        `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text-target"]`
      );
      const wrapper = target;
      expect(await wrapper.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("PT Serif");
      expect(await wrapper.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("300");
      expect(await wrapper.evaluate((el) => getComputedStyle(el).fontStyle)).toBe("italic");
      expect(await wrapper.evaluate((el) => getComputedStyle(el).fontSize)).toBe("48px");
      expect(await wrapper.evaluate((el) => getComputedStyle(el).textAlign)).toBe("right");
    } finally {
      await close();
    }
  });

  test("the rounded rectangle stands in the dock and the type picker; the line is gone", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-shape-text-rounded");
    try {
      await toCanvas(a, "a");
      const view = canvasView(a, "a");
      const dock = view.getByRole("toolbar", { name: "Canvas tools" });

      // The dock's shapes menu: the four types (no line).
      await dock.getByLabel("Shapes").click();
      const menu = a.locator('[data-slot="docblocks/canvas-shapes-menu"]');
      await expect(menu.getByLabel("Rectangle", { exact: true })).toBeVisible();
      await expect(menu.getByLabel("Rounded Rectangle")).toBeVisible();
      await expect(menu.getByLabel("Ellipse")).toBeVisible();
      await expect(menu.getByLabel("Diamond")).toBeVisible();
      expect(await menu.getByLabel("Line").count()).toBe(0);

      // The click-to-place lands the rounded shape (the default box).
      await menu.getByLabel("Rounded Rectangle").click();
      const box = (await view.boundingBox())!;
      await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const placed = await a.evaluate(
        ({ client }) => {
          const docs = window.__paneDocs;
          const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
          if (doc === null) return null;
          const json = doc.toJSON();
          const shape = Object.entries(json.blocks).find(([, block]) => block.type === "shape");
          return shape !== undefined && shape[1].type === "shape"
            ? { id: shape[0], attrs: shape[1].attrs ?? null }
            : null;
        },
        { client: "a" }
      );
      expect(placed?.attrs).toMatchObject({ variant: "rounded" });

      // The placed shape's figure: the rect with the corner radius.
      const figure = view.locator('[data-slot="docblocks/shape"][data-variant="rounded"] rect');
      expect(await figure.getAttribute("rx")).not.toBeNull();

      // The selection's type picker: the four variants (no line), the
      // current one checked.
      await selectShape(a, "a", placed!.id);
      const toolbar = view.locator('[data-slot="docblocks/shape-toolbar"]');
      await expect(toolbar).toBeVisible();
      await toolbar.locator('[data-slot="docblocks/shape-toolbar-variant"]').click();
      // The menu's computed name stands the trigger's label (the
      // content's aria-label is not the computed name) — the items are
      // the only open menu's, the page stands no other.
      await expect(a.getByRole("menuitemcheckbox", { name: "Rounded Rectangle" })).toBeChecked();
      expect(await a.getByLabel("Line").count()).toBe(0);
    } finally {
      await close();
    }
  });

  test("the soft breaks stand the rendered lines (the pre-wrap wrap, the vertical centering)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "canvas-shape-text-wrap");
    try {
      await toCanvas(a, "a");
      const id = await seedShape(a, "a", { variant: "rect", text: "Строка1\nСтрока2" }, { x: 0, y: 0, w: 160, h: 80 });
      const view = canvasView(a, "a");
      const overlay = view.locator(
        `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text"]`
      );
      expect(await overlay.evaluate((el) => (el as HTMLElement).innerText)).toBe("Строка1\nСтрока2");
      // The wrap at the figure's edges (the pre-wrap) and the vertical
      // centering (the target box's flex stand).
      const wrapper = view.locator(
        `[data-slot="docblocks/canvas-item"][data-block-id="${id}"] [data-slot="docblocks/shape-text-target"]`
      );
      expect(await wrapper.evaluate((el) => getComputedStyle(el).whiteSpace)).toBe("pre-wrap");
      expect(await wrapper.evaluate((el) => getComputedStyle(el).alignItems)).toBe("center");
    } finally {
      await close();
    }
  });
});
