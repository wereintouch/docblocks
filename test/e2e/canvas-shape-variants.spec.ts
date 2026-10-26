import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The new figure variants: the cylinder
// and the cloud stand the dock's shapes menu (the placement), the shape
// toolbar's type picker (the switch), and the sync over the wire (the
// other pane's svg stands from the same attr).
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
  await switchPaneView(page, client, "canvas");
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** The doc's shape blocks (the type + the variant attr). */
async function shapesOf(page: Page, client: "a" | "b"): Promise<Record<string, { type: string; variant?: string }>> {
  return page.evaluate(
    ({ client }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === null || doc === undefined) return {};
      const out: Record<string, { type: string; variant?: string }> = {};
      for (const [id, block] of Object.entries(doc.toJSON().blocks)) {
        const entry = block as { type: string; attrs?: { variant?: unknown } };
        if (entry.type === "shape") {
          out[id] = {
            type: entry.type,
            variant: typeof entry.attrs?.variant === "string" ? entry.attrs.variant : undefined,
          };
        }
      }
      return out;
    },
    { client }
  );
}

/** The doc's first shape of the variant's geometry (the center anchor, the canvas px). */
async function shapeGeometry(page: Page, client: "a" | "b", variant: string) {
  return page.evaluate(
    ({ client, variant }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === null || doc === undefined) return null;
      for (const block of Object.values(doc.toJSON().blocks)) {
        const entry = block as {
          type: string;
          attrs?: { variant?: unknown };
          geometry?: { x: number; y: number; w: number; h: number };
        };
        if (entry.type === "shape" && entry.attrs?.variant === variant) return entry.geometry ?? null;
      }
      return null;
    },
    { client, variant }
  );
}

test.describe("the new figure variants", () => {
  test("the cylinder and the cloud: the dock's placement over the wire, the toolbar's switch, the undo", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-shape-variants");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");

      // The dock's shapes menu places the cylinder (the default 100x120
      // stand) — the attr stands in A and reaches B over the wire.
      const center = await canvasCenter(a, "a");
      const shapes = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" }).getByLabel("Shapes");
      await shapes.click();
      const menu = a.locator('[data-slot="docblocks/canvas-shapes-menu"]');
      await menu.getByLabel("Cylinder").click();
      const clickX = center.x - 200;
      const clickY = center.y - 100;
      await a.mouse.click(clickX, clickY);
      await expect
        .poll(async () => Object.values(await shapesOf(a, "a")).filter((s) => s.variant === "cylinder").length, SETTLE)
        .toBe(1);
      await expect
        .poll(async () => Object.values(await shapesOf(b, "b")).some((s) => s.variant === "cylinder"), SETTLE)
        .toBe(true);
      // The cylinder's figure stands in both panes (the body path + the
      // top cap's seam).
      const cylinderA = a.locator('[data-slot="docblocks/shape"][data-variant="cylinder"]');
      await expect(cylinderA).toHaveCount(1);
      expect(await cylinderA.locator("path").count()).toBe(2);
      await expect(b.locator('[data-slot="docblocks/shape"][data-variant="cylinder"]')).toHaveCount(1);

      // The selection's type picker switches the cylinder to the cloud
      // (one updateBlock; the other pane's figure follows over the wire).
      const cylBox = (await cylinderA.boundingBox())!;
      await a.mouse.click(cylBox.x + cylBox.width / 2, cylBox.y + cylBox.height / 2);
      const toolbar = a.getByRole("toolbar", { name: "Shape options" });
      await expect(toolbar).toBeVisible();
      await toolbar.getByLabel("Shape type").click();
      await a.getByRole("menuitemcheckbox", { name: "Cloud" }).click();
      await expect
        .poll(async () => Object.values(await shapesOf(a, "a")).filter((s) => s.variant === "cloud").length, SETTLE)
        .toBe(1);
      await expect
        .poll(async () => Object.values(await shapesOf(b, "b")).some((s) => s.variant === "cloud"), SETTLE)
        .toBe(true);
      await expect(a.locator('[data-slot="docblocks/shape"][data-variant="cloud"]')).toHaveCount(1);
      await expect(b.locator('[data-slot="docblocks/shape"][data-variant="cloud"]')).toHaveCount(1);

      // The two-step undo (the switch, then the removal — the placement's
      // transact) stands back the doc over the wire.
      await a.keyboard.press("Escape");
      await canvasView(a, "a").focus();
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => Object.values(await shapesOf(a, "a")).filter((s) => s.variant === "cylinder").length, SETTLE)
        .toBe(1);
      await a.keyboard.press("Control+z");
      await expect.poll(async () => Object.values(await shapesOf(a, "a")).length, SETTLE).toBe(0);
    } finally {
      await close();
    }
  });

  test("the cylinder and the cloud: the drag-to-size session (the preview's stand, the dragged box's commit)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-shape-drag-size");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const center = await canvasCenter(a, "a");
      const preview = canvasView(a, "a").locator('[data-slot="docblocks/canvas-place-preview"]');
      const shapes = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" }).getByLabel("Shapes");

      // The cylinder's press-drag: the
      // place session stands the dashed preview at the drag's box
      // mid-drag, the release commits the dragged box (the center anchor
      // at the drag's midpoint; one transact — the geometry over the
      // wire to the other pane).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Cylinder").click();
      await a.mouse.move(center.x - 150, center.y - 75);
      await a.mouse.down();
      await a.mouse.move(center.x + 50, center.y + 25, { steps: 5 });
      await expect(preview).toBeVisible();
      await expect(preview.locator('[data-slot="docblocks/shape"][data-variant="cylinder"]')).toHaveCount(1);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "cylinder");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === -50 && geo.y === -25;
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(b, "b", "cylinder");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === -50 && geo.y === -25;
        }, SETTLE)
        .toBe(true);
      // The preview drops and the tool resets (the click-place's stand).
      await expect(preview).toHaveCount(0);

      // The cloud's press-drag (the second variant's stand — the same
      // session over the new tool pick).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Cloud").click();
      await a.mouse.move(center.x + 100, center.y - 160);
      await a.mouse.down();
      await a.mouse.move(center.x + 250, center.y - 80, { steps: 5 });
      await expect(preview.locator('[data-slot="docblocks/shape"][data-variant="cloud"]')).toHaveCount(1);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "cloud");
          return geo !== null && geo.w === 150 && geo.h === 80 && geo.x === 175 && geo.y === -120;
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(b, "b", "cloud");
          return geo !== null && geo.w === 150 && geo.h === 80 && geo.x === 175 && geo.y === -120;
        }, SETTLE)
        .toBe(true);

      // The one-step undo (the cloud's transact) stands the cloud gone
      // over the wire (the cylinder stands).
      await a.keyboard.press("Escape");
      await canvasView(a, "a").focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => await shapeGeometry(a, "a", "cloud"), SETTLE).toBeNull();
      expect(await shapeGeometry(a, "a", "cylinder")).not.toBeNull();
    } finally {
      await close();
    }
  });

  test("the shift's 1:1 on the drag-to-size place (the square's stand, the free's regression, the live toggle)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-shape-shift-1to1");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const center = await canvasCenter(a, "a");
      const preview = canvasView(a, "a").locator('[data-slot="docblocks/canvas-place-preview"]');
      const shapes = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" }).getByLabel("Shapes");

      // (a) The ellipse's shift drag: the mid-drag preview stands the square
      // (W = H — the larger span wins), the release commits the circle over
      // the wire (both panes stand the same geometry).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Ellipse", { exact: true }).click();
      await a.keyboard.down("Shift");
      await a.mouse.move(center.x - 100, center.y - 60);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 60, { steps: 5 });
      // The mid-drag preview is the square (the constraint's live stand —
      // the larger span's 200 wins over the 120's height).
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeLessThan(2);
      await a.mouse.up();
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "ellipse");
          return geo !== null && geo.w === 200 && geo.h === 200 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(b, "b", "ellipse");
          return geo !== null && geo.w === 200 && geo.h === 200 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);
      await expect(preview).toHaveCount(0);

      // (b) The rect's shift drag: the square (the W = H's stand — the
      // vertical span's 160 wins over the 60's width).
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Rectangle", { exact: true }).click();
      await a.keyboard.down("Shift");
      await a.mouse.move(center.x - 80, center.y - 80);
      await a.mouse.down();
      await a.mouse.move(center.x + 80, center.y - 20, { steps: 5 });
      await a.mouse.up();
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "rect");
          return geo !== null && geo.w === 160 && geo.h === 160 && geo.x === 0 && geo.y === -50;
        }, SETTLE)
        .toBe(true);

      // (c) The free drag (no shift): the W×H stands (the regression — the
      // constraint is off, the dragged box's stand).
      await shapes.click();
      await a
        .locator('[data-slot="docblocks/canvas-shapes-menu"]')
        .getByLabel("Rounded Rectangle", { exact: true })
        .click();
      await a.mouse.move(center.x - 100, center.y - 50);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 50, { steps: 5 });
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "rounded");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);

      // (d) The live toggle: the shift's keydown over the standing drag
      // squares the preview (the center stands), the keyup frees it again —
      // the release commits the free box (the shift's drop before the up).
      await canvasView(a, "a").focus();
      await shapes.click();
      await a.locator('[data-slot="docblocks/canvas-shapes-menu"]').getByLabel("Diamond", { exact: true }).click();
      await a.mouse.move(center.x - 100, center.y - 50);
      await a.mouse.down();
      await a.mouse.move(center.x + 100, center.y + 50, { steps: 5 });
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      const freeCenter = await preview.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await a.keyboard.down("Shift");
      // The shift's keydown squares the preview (the live stand — the center
      // stands the drag's midpoint, the size grows to the larger span).
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeLessThan(2);
      const shiftCenter = await preview.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      expect(Math.abs(shiftCenter.x - freeCenter.x)).toBeLessThan(2);
      expect(Math.abs(shiftCenter.y - freeCenter.y)).toBeLessThan(2);
      await a.keyboard.up("Shift");
      await expect
        .poll(async () => {
          const bb = (await preview.boundingBox())!;
          return Math.abs(bb.width - bb.height);
        }, SETTLE)
        .toBeGreaterThan(40);
      await a.mouse.up();
      await expect
        .poll(async () => {
          const geo = await shapeGeometry(a, "a", "diamond");
          return geo !== null && geo.w === 200 && geo.h === 100 && geo.x === 0 && geo.y === 0;
        }, SETTLE)
        .toBe(true);

      // The one-step undo (the diamond's transact) stands the diamond gone
      // over the wire (the others stand).
      await a.keyboard.press("Escape");
      await canvasView(a, "a").focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => await shapeGeometry(a, "a", "diamond"), SETTLE).toBeNull();
      expect(await shapeGeometry(a, "a", "ellipse")).not.toBeNull();
    } finally {
      await close();
    }
  });
});
