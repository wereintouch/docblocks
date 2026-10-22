import { type Browser, type Page, expect, test } from "@playwright/test";

// The connector's style attrs: the
// strokeColor (the data hex), the strokeWidth (the 1–4 px stand), the
// arrowHead's figure (none / arrow / circle) and the arrowStart stand —
// the toolbar's applies over the wire (one updateBlock per apply), the
// the render (the data color / width stand on the line, the per-fill
// arrowhead defs), and the one-step undo. The selection's cyan emphasis
// stands over the data color (the emphasis follows the selection).
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

/** Seed a surface + two rects (the line runs through the canvas center). */
async function seedLine(page: Page, client: "a" | "b"): Promise<void> {
  await page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    doc.transact(() => {
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -100, y: 0, w: 100, h: 60 });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(b, { x: 100, y: 0, w: 100, h: 60 });
      doc.insertBlock("connector", { start: { blockId: a }, end: { blockId: b } }, { parent: surface });
    });
  }, client);
}

/** The pane's connector block's attrs (the doc's own read). */
function connectorAttrs(page: Page, client: "a" | "b") {
  return page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    const blocks = doc.toJSON().blocks;
    const entry = Object.values(blocks).find((block) => block.type === "connector") as
      { attrs: Record<string, unknown> } | undefined;
    return entry?.attrs ?? null;
  }, client);
}

test.describe("the connector's style attrs", () => {
  test("the toolbar's applies over the wire (the color / width / arrowhead / start side, the one-step undo)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-conn-style");
    try {
      await a.getByTestId("view-a-canvas").click();
      await b.getByTestId("view-b-canvas").click();
      await seedLine(a, "a");
      // The wire's settle (the shapes + the line stand in B).
      await expect
        .poll(
          async () => (await b.locator('[data-testid="doc-b"] [data-slot="docblocks/canvas-item"]').count()) >= 3,
          SETTLE
        )
        .toBe(true);

      // The line's press: the straight line runs through the canvas
      // center (the shapes' west / east edges at y = 0).
      const view = a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]');
      const box = (await view.boundingBox())!;
      await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const toolbar = a.getByRole("toolbar", { name: "Connector options" });
      await expect(toolbar).toBeVisible();

      // The width (the slider's right edge press: the 4 px dot's snap).
      const slider = a.locator('[data-slot="docblocks/figure-border-selector"]');
      const sliderBox = (await slider.boundingBox())!;
      await a.mouse.click(sliderBox.x + sliderBox.width - 2, sliderBox.y + sliderBox.height / 2);
      // The color (the palette popover's hex commit).
      await a.getByLabel("Line color").click();
      const hex = a.getByLabel("Line color hex value");
      await hex.fill("#ff0000");
      await hex.press("Enter");
      // The arrowhead's figure (the Circle pick).
      await a.getByLabel("Arrowhead").click();
      await a.getByRole("menuitemcheckbox", { name: "Circle" }).click();
      // The start side (the toggle).
      await a.getByLabel("Arrow at the start").click();

      // The attrs stand in A and reach B over the wire (one updateBlock
      // per apply — the JSON's settle).
      await expect
        .poll(async () => {
          const attrs = await connectorAttrs(a, "a");
          return (
            attrs !== null &&
            attrs.strokeWidth === 4 &&
            attrs.strokeColor === "#ff0000" &&
            attrs.arrowHead === "circle" &&
            attrs.arrowStart === true
          );
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const attrs = await connectorAttrs(b, "b");
          return (
            attrs !== null && attrs.strokeWidth === 4 && attrs.strokeColor === "#ff0000" && attrs.arrowStart === true
          );
        }, SETTLE)
        .toBe(true);

      // The render (the line stands selected — the cyan emphasis over
      // the data color, the width's bump 4 + 1).
      const line = a.locator("[data-connector-id]");
      await expect(line).toHaveAttribute("stroke-width", "5");

      // The Escape's deselect: the data color / width stand (the theme
      // token stands gone — the data hex renders).
      await a.keyboard.press("Escape");
      await expect(line).toHaveAttribute("stroke-width", "4");
      const stroke = await line.evaluate((el) => (el as SVGPathElement).style.stroke);
      expect(stroke).toBe("rgb(255, 0, 0)");

      // The one-step undo chain: the arrowStart's revert (the last
      // apply), then the arrowHead's, then the color's, then the
      // width's (each apply is one transact). The focus is re-seated on
      // the canvas view first (the portaled menu's press dropped the
      // focus off the editor — the hotkey stands the editor's focus).
      await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.arrowStart, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.arrowHead, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeColor, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeWidth, SETTLE).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("the label's inline edit over the wire (the line's double-click, the select-all's clear, the empty's removed stand)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-conn-label");
    try {
      await a.getByTestId("view-a-canvas").click();
      await b.getByTestId("view-b-canvas").click();
      await seedLine(a, "a");
      await expect
        .poll(
          async () => (await b.locator('[data-testid="doc-b"] [data-slot="docblocks/canvas-item"]').count()) >= 3,
          SETTLE
        )
        .toBe(true);

      // The line's double-click (the midpoint's press: the line runs
      // through the canvas center) opens the label's inline edit (the
      // chip over the midpoint; the toolbar's label input stands gone).
      const box = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
      const midX = box.x + box.width / 2;
      const midY = box.y + box.height / 2;
      await a.mouse.dblclick(midX, midY);
      const input = a.locator('[data-slot="docblocks/connector-label-edit"]');
      await expect(input).toBeVisible();
      await expect(a.getByLabel("Line label")).toHaveCount(0); // the toolbar's input stands gone

      // The typed commit (the Enter): the attr stands in A and reaches B
      // over the wire; the midpoint's text stands in both panes.
      await input.fill("link");
      await input.press("Enter");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.label, SETTLE).toBe("link");
      await expect.poll(async () => (await connectorAttrs(b, "b"))?.label, SETTLE).toBe("link");
      await expect(a.locator("[data-connector-label]")).toHaveText("link");
      await expect(b.locator("[data-connector-label]")).toHaveText("link");

      // The select-all + the Backspace + the outside click's commit: the
      // empty stand is the removed state (the attr stands the empty
      // string — the one updateBlock over the wire). The second
      // double-click stands over the rendered chip (pointer-transparent)
      // on the hit path — the edit reopens over its seed.
      await a.mouse.dblclick(midX, midY);
      await expect(input).toBeVisible();
      await input.dblclick(); // the double-click over the text: the select-all (the "link" seed)
      await a.keyboard.press("Backspace"); // the selection's clear (the native stand)
      await a.mouse.click(midX + 300, midY + 200); // the outside click's commit
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.label, SETTLE).toBe("");
      await expect.poll(async () => (await connectorAttrs(b, "b"))?.label, SETTLE).toBe("");
      await expect(a.locator("[data-connector-label]")).toHaveCount(0);

      // The undo chain (the focus re-seated on the canvas view — the
      // commit's blur dropped the focus off the editor): the clear's
      // revert stands the prior label back, the write's revert stands
      // the label gone (one transact per edit step).
      await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.label, SETTLE).toBe("link");
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.label, SETTLE).toBeUndefined();
      await expect(a.locator("[data-connector-label]")).toHaveCount(0);
    } finally {
      await close();
    }
  });
});
