// The connector's label's inline edit (the line's double-click's entry —
// the contenteditable over the chip, the select-all's clear, the empty's
// removed stand) + the label chip's always stand (the opaque theme
// background over the line's own frame).
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

test("the label's inline edit over the wire (the line's double-click, the select-all's clear, the empty's removed stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "canvas-conn-label");
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

// The label's CHIP: the chip stands always
// (not only in the edit) — the opaque theme background over the 1px frame
// of the line's own color, at the line's midpoint. The selected line's
// emphasis stands the frame too (the selected token over the data color).
test("the label's chip stands always (the opaque theme background over the line's own frame)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "canvas-conn-chip");
  try {
    await switchPaneView(a, "a", "canvas");
    await seedLine(a, "a");
    // The line's data color (the frame's color) + the label.
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const blocks = doc.toJSON().blocks;
      const surfaceId = Object.keys(blocks).find((id) => blocks[id]?.type === "surface")!;
      const ids = doc.getChildren(surfaceId);
      const conn = ids.find((id) => blocks[id]?.type === "connector")!;
      doc.transact(() => {
        doc.updateBlock(conn, { strokeColor: "#cf9155", label: "the chip" });
      });
    });

    const chip = a.locator("[data-connector-label]");
    await expect(chip).toHaveCount(1); // the chip stands (the line is unselected)
    await expect(chip).toHaveText("the chip");
    const stand = await chip.evaluate((el) => {
      const computed = getComputedStyle(el);
      const probe = document.createElement("div");
      probe.style.background = "var(--background)";
      document.body.appendChild(probe);
      const tokenBg = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        bg: computed.backgroundColor,
        border: computed.borderTopColor,
        pointerEvents: computed.pointerEvents,
        tokenBg,
      };
    });
    // The opaque theme background (the adaptive token — stands --background,
    // never transparent).
    expect(stand.bg).toBe(stand.tokenBg);
    expect(stand.bg).not.toContain("rgba(0, 0, 0, 0)");
    // The 1px frame stands the line's own color (the data's
    // strokeColor — the dark theme's dark corridor's effective value:
    // the frame and the line stand the same effective color).
    expect(stand.border).not.toBe("rgb(207, 145, 85)");
    expect(stand.border).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    const borderR = stand.border.match(/^rgb\((\d+)/);
    expect(borderR === null ? 255 : Number.parseInt(borderR[1]!, 10)).toBeLessThan(100);
    // The pointer-transparent stand (the line's hit path keeps the click).
    expect(stand.pointerEvents).toBe("none");

    // The press over the chip (pointer-transparent) selects the line (the
    // click passes through to the hit path); the selection's emphasis
    // stands the frame (the selected token over the data color).
    const box = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
    await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(a.locator("[data-connector-id]").first()).toHaveAttribute("data-selected", "true");
    const selectedStand = await chip.evaluate((el) => {
      const computed = getComputedStyle(el);
      // The probe stands in the editor root (the --docblocks-* tokens
      // stand there, not on :root).
      const root = el.closest('[data-slot="docblocks/editor"]') ?? document.body;
      const probe = document.createElement("span");
      probe.style.border = "1px solid var(--docblocks-canvas-selected-stroke)";
      probe.style.position = "absolute";
      probe.style.visibility = "hidden";
      root.appendChild(probe);
      const tokenBorder = getComputedStyle(probe).borderTopColor;
      probe.remove();
      return { border: computed.borderTopColor, tokenBorder };
    });
    expect(selectedStand.border).toBe(selectedStand.tokenBorder);
  } finally {
    await close();
  }
});

// The stroke style's solid / dashed picks: the dasharray
// over the wire (the data stand on the line in both panes), the no-op
// stand (a re-pick of the current style writes nothing), and the one-step
// undo. The pending preview line stands the solid default (the new line
// has no style) — the cyan color is the preview's stand, not a dash.
