import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The connector's style attrs: the
// strokeColor (the data hex), the strokeWidth (the 1–4 px stand), and the
// two arrowheads' figures (none / arrow / circle — the start's independent
// figure) — the toolbar's applies over the
// wire (one updateBlock per apply), the render (the data color / width
// stand on the line, the per-fill arrowhead defs — the start's and the
// end's figures stand independently), and the one-step undo. The
// selection's cyan emphasis stands over the data color (the emphasis
// follows the selection).
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

/**
 * The pane's connector line's midpoint in the canvas view's screen space
 * (the straight's `d` = `M x1 y1 L x2 y2`: the endpoints' average). At the
 * default zoom (1) + pan (0) the world's point stands at the canvas view's
 * center offset by the world's delta — the chip's own stand (the chip and
 * the line stand from one number, the single source's contract).
 */
async function lineMidScreen(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  return page.evaluate((c) => {
    const doc = document.querySelector(`[data-testid="doc-${c}"]`)!;
    const path = doc.querySelector<SVGPathElement>("[data-connector-id]")!;
    const d = path.getAttribute("d")!;
    const nums = d
      .split(/[^0-9.eE-]+/)
      .filter(Boolean)
      .map(Number);
    const mid = { x: (nums[0]! + nums[2]!) / 2, y: (nums[1]! + nums[3]!) / 2 };
    const view = doc.querySelector<HTMLElement>('[data-slot="docblocks/canvas-view"]')!;
    const rect = view.getBoundingClientRect();
    return { x: rect.x + rect.width / 2 + mid.x, y: rect.y + rect.height / 2 + mid.y };
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
      // token stands gone — the data hex renders).
      await a.keyboard.press("Escape");
      await expect(line).toHaveAttribute("stroke-width", "4");
      const stroke = await line.evaluate((el) => (el as SVGPathElement).style.stroke);
      expect(stroke).toBe("rgb(255, 0, 0)");

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
  test("the label's chip stands always (the opaque theme background over the line's own frame)", async ({
    browser,
  }) => {
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
      // The 1px frame stands the line's own color (the data's strokeColor).
      expect(stand.border).toBe("rgb(207, 145, 85)"); // #cf9155
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

  // The stroke style's solid / dashed picks (2026-10-22): the dasharray
  // over the wire (the data stand on the line in both panes), the no-op
  // stand (a re-pick of the current style writes nothing), and the one-step
  // undo. The pending preview line stands the solid default (the new line
  // has no style) — the cyan color is the preview's stand, not a dash.
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

// The label chip's live stand (the owner bug 2026-10-26): the chip is the
// line's midpoint and must follow the line MID-DRAG (the connected item's
// move — the preview's re-draw) and stand NO jump on release (the
// preview's stand is the commit's stand — the chip and the line stand from
// one number). The pre-fix stand: the chip lags at the committed seat.
test("the label's chip follows the line mid-drag and stands no jump on release (the connected block's move)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "canvas-conn-chip-follow");
  try {
    await switchPaneView(a, "a", "canvas");
    // Seed a surface + two rects + a labeled connector (the line runs
    // through the canvas center: a west, b east).
    const ids = await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      let surface = "";
      let sa = "";
      let sb = "";
      let conn = "";
      doc.transact(() => {
        surface = doc.insertBlock("surface");
        sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: 0, w: 100, h: 60 });
        sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 0, w: 100, h: 60 });
        conn = doc.insertBlock(
          "connector",
          { start: { blockId: sa }, end: { blockId: sb }, label: "follows" },
          { parent: surface }
        );
      });
      return { surface, sa, sb, conn };
    });

    const chip = a.locator("[data-connector-label]");
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveText("follows");

    // Shape b's screen box (the drag's target — the line's east end).
    const bBox = (await a.locator(`[data-block-id="${ids.sb}"]`).first().boundingBox())!;
    expect(bBox, "shape b's box must stand").not.toBeNull();

    // Drag shape b (the move session's press + drag) by a screen delta.
    const dx = 120;
    const dy = 80;
    const sx = bBox.x + bBox.width / 2;
    const sy = bBox.y + bBox.height / 2;
    await a.mouse.move(sx, sy);
    await a.mouse.down();
    await a.mouse.move(sx + dx, sy + dy, { steps: 8 });

    // MID-DRAG: the chip stands the line's live midpoint (it follows the
    // moving block — the chip and the line stand from one number). The
    // pre-fix stand: the chip lags at the committed seat.
    const midDrag = await lineMidScreen(a, "a");
    const chipMid = (await chip.boundingBox())!;
    expect(Math.abs(chipMid.x + chipMid.width / 2 - midDrag.x)).toBeLessThan(2);
    expect(Math.abs(chipMid.y + chipMid.height / 2 - midDrag.y)).toBeLessThan(2);

    // The release commits the preview's stand (one setGeometry over the
    // wire). NO JUMP: the chip stands the committed midpoint (the preview's
    // stand is the commit's stand — the same seat as mid-drag).
    await a.mouse.up();
    const midEnd = await lineMidScreen(a, "a");
    const chipEnd = (await chip.boundingBox())!;
    expect(Math.abs(chipEnd.x + chipEnd.width / 2 - midEnd.x)).toBeLessThan(2);
    expect(Math.abs(chipEnd.y + chipEnd.height / 2 - midEnd.y)).toBeLessThan(2);
  } finally {
    await close();
  }
});

// The label chip's live stand over the ENDPOINT's re-draw (the owner bug
// 2026-10-26, scenario a): dragging the selected line's endpoint handle
// re-draws the line live; the chip (the midpoint) follows mid-drag and
// stands no jump on release. The pre-fix stand: the chip lags at the
// committed seat.
test("the label's chip follows the line mid-drag over the endpoint's re-draw (the endpoint handle's drag)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "canvas-conn-chip-follow-endpoint");
  try {
    await switchPaneView(a, "a", "canvas");
    // A surface + two rects + a labeled connector with a FREE end (the
    // endpoint's drag is unambiguous — the free point follows the pointer;
    // no box-anchor / no port-snap over the drag's delta).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        const surface = doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: 0, w: 100, h: 60 });
        const sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 0, w: 100, h: 60 });
        doc.insertBlock(
          "connector",
          { start: { blockId: sa }, end: { x: 150, y: 0 }, label: "follows" },
          { parent: surface }
        );
      });
    });

    const chip = a.locator("[data-connector-label]");
    await expect(chip).toHaveCount(1);

    // Select the line (the midpoint's press) — the endpoint's handles
    // stand.
    const box = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
    await a.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const endHandle = a.locator('[data-connector-endpoint="end"]');
    await expect(endHandle).toBeVisible();
    const handleBox = (await endHandle.boundingBox())!;

    // Drag the end's endpoint (the line's re-draw) by a screen delta.
    const dx = 80;
    const dy = 120;
    const hx = handleBox.x + handleBox.width / 2;
    const hy = handleBox.y + handleBox.height / 2;
    await a.mouse.move(hx, hy);
    await a.mouse.down();
    await a.mouse.move(hx + dx, hy + dy, { steps: 8 });

    // MID-DRAG: the chip stands the line's live midpoint (the re-draw's
    // stand — the pre-fix lag stands the committed seat).
    const midDrag = await lineMidScreen(a, "a");
    const chipMid = (await chip.boundingBox())!;
    expect(Math.abs(chipMid.x + chipMid.width / 2 - midDrag.x)).toBeLessThan(2);
    expect(Math.abs(chipMid.y + chipMid.height / 2 - midDrag.y)).toBeLessThan(2);

    // The release commits (the preview's stand is the commit's stand) — no
    // jump.
    await a.mouse.up();
    const midEnd = await lineMidScreen(a, "a");
    const chipEnd = (await chip.boundingBox())!;
    expect(Math.abs(chipEnd.x + chipEnd.width / 2 - midEnd.x)).toBeLessThan(2);
    expect(Math.abs(chipEnd.y + chipEnd.height / 2 - midEnd.y)).toBeLessThan(2);
  } finally {
    await close();
  }
});
