// The connector's style attrs: the
// strokeColor (the data hex), the strokeWidth (the 1–4 px stand), and the
// two arrowheads' figures (none / arrow / circle — the start's independent
// figure) — the toolbar's applies over the
// wire (one updateBlock per apply), the render (the data color / width
// stand on the line, the per-fill arrowhead defs — the start's and the
// end's figures stand independently), and the one-step undo. The
// selection's cyan emphasis stands over the data color (the emphasis
// follows the selection).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, switchPaneView, twoPanes } from "./helpers";

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
  test("the toolbar's applies over the wire (the color / width / the two arrowheads, the one-step undo)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-conn-style");
    try {
      await switchPaneView(a, "a", "canvas");
      await switchPaneView(b, "b", "canvas");
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
      const line = a.locator("[data-connector-id]").first();

      // The initial stand: the end's default arrow (marker-end) stands,
      // no start marker (marker-start is null — the absent figure).
      expect(await line.getAttribute("marker-start")).toBeNull();
      expect(await line.getAttribute("marker-end")).not.toBeNull();

      // The width (the slider's right edge press: the 4 px dot's snap).
      const slider = a.locator('[data-slot="docblocks/figure-border-selector"]');
      const sliderBox = (await slider.boundingBox())!;
      await a.mouse.click(sliderBox.x + sliderBox.width - 2, sliderBox.y + sliderBox.height / 2);
      // The color (the palette popover's hex commit).
      await a.getByLabel("Line color").click();
      const hex = a.getByLabel("Line color hex value");
      await hex.fill("#ff0000");
      await hex.press("Enter");
      // The START arrowhead (the start's own figure — the Arrow pick).
      await a.getByLabel("Start arrowhead").click();
      await a.getByRole("menuitemcheckbox", { name: "Arrow" }).click();
      // The END arrowhead (the end's own figure — the Circle pick).
      await a.getByLabel("End arrowhead").click();
      await a.getByRole("menuitemcheckbox", { name: "Circle" }).click();

      // The two figures stand independently:
      // the start's arrow marker (-s) and the end's circle marker (-ci)
      // both stand on the line (distinct defs).
      const startMarker = (await line.getAttribute("marker-start"))!;
      const endMarker = (await line.getAttribute("marker-end"))!;
      expect(startMarker).toMatch(/-s\)$/);
      expect(endMarker).toMatch(/-ci\)$/);
      expect(startMarker).not.toBe(endMarker);

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
            attrs.arrowStart === "arrow"
          );
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const attrs = await connectorAttrs(b, "b");
          return (
            attrs !== null &&
            attrs.strokeWidth === 4 &&
            attrs.strokeColor === "#ff0000" &&
            attrs.arrowHead === "circle" &&
            attrs.arrowStart === "arrow"
          );
        }, SETTLE)
        .toBe(true);

      // The render (the line stands selected — the cyan emphasis over
      // the data color, the width's bump 4 + 1).
      await expect(line).toHaveAttribute("stroke-width", "5");

      // The Escape's deselect: the data color / width stand (the theme
      // token stands gone — the data hex renders over the dark theme's
      // dark corridor's effective value — the render-time's transform's
      // stand, the data's hex stands in the attrs).
      await a.keyboard.press("Escape");
      await expect(line).toHaveAttribute("stroke-width", "4");
      const stroke = (await line.evaluate((el) => (el as SVGPathElement).style.stroke))!;
      expect(stroke).not.toBe("rgb(255, 0, 0)");
      expect(stroke).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
      const strokeR = stroke.match(/^rgb\((\d+)/);
      expect(strokeR === null ? 255 : Number.parseInt(strokeR[1]!, 10)).toBeLessThan(100);

      // The one-step undo chain: the end arrowhead's revert (the last
      // apply), then the start's, then the color's, then the width's
      // (each apply is one transact). The focus is re-seated on the
      // canvas view first (the portaled menu's press dropped the focus
      // off the editor — the hotkey stands the editor's focus).
      await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.arrowHead, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.arrowStart, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeColor, SETTLE).toBeUndefined();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeWidth, SETTLE).toBeUndefined();
    } finally {
      await close();
    }
  });

  test("the stroke style's solid / dashed picks (the dasharray over the wire, the no-op stand, the undo)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-conn-stroke-style");
    try {
      await switchPaneView(a, "a", "canvas");
      await switchPaneView(b, "b", "canvas");
      await seedLine(a, "a");
      await expect
        .poll(
          async () => (await b.locator('[data-testid="doc-b"] [data-slot="docblocks/canvas-item"]').count()) >= 3,
          SETTLE
        )
        .toBe(true);

      // The line's press: the straight line runs through the canvas center.
      const box = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
      await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const toolbar = a.getByRole("toolbar", { name: "Connector options" });
      await expect(toolbar).toBeVisible();
      const line = a.locator("[data-connector-id]").first();

      // The two style options stand (the solid / the dashed).
      await expect(a.getByLabel("Solid line")).toBeVisible();
      await expect(a.getByLabel("Dashed line")).toBeVisible();
      // The solid default: no dasharray; the solid pick is the no-op stand.
      expect(await line.getAttribute("stroke-dasharray")).toBeNull();
      await a.getByLabel("Solid line").click();
      expect((await connectorAttrs(a, "a"))?.strokeStyle).toBeUndefined();

      // The dashed pick: one updateBlock (the dasharray stands over the wire
      // in both panes).
      await a.getByLabel("Dashed line").click();
      await expect(line).toHaveAttribute("stroke-dasharray", "8 4");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeStyle, SETTLE).toBe("dash");
      await expect.poll(async () => (await connectorAttrs(b, "b"))?.strokeStyle, SETTLE).toBe("dash");
      const lineB = b.locator("[data-connector-id]").first();
      await expect(lineB).toHaveAttribute("stroke-dasharray", "8 4");

      // The no-op stand: a re-pick of the current (dashed) writes nothing.
      const beforeDash = JSON.stringify(await connectorAttrs(a, "a"));
      await a.getByLabel("Dashed line").click();
      expect(JSON.stringify(await connectorAttrs(a, "a"))).toBe(beforeDash);

      // The one-step undo: the dashed's revert stands the solid back.
      await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
      await a.keyboard.press("Control+z");
      await expect.poll(async () => (await connectorAttrs(a, "a"))?.strokeStyle, SETTLE).toBeUndefined();
      await expect.poll(async () => await line.getAttribute("stroke-dasharray"), SETTLE).toBeNull();
    } finally {
      await close();
    }
  });
});
