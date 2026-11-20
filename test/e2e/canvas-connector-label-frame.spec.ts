// The connector's label chip's frame: the frame stands the line (the width
// over the strokeWidth attr, the style over the strokeStyle — the dynamic
// stand; the label's padding; the endpoint figures' sizes).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane, switchPaneView } from "./helpers";

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

test("the label chip's frame stands the line (the width over the strokeWidth attr, the style over the strokeStyle — the dynamic stand; the label's padding; the endpoint figures' sizes)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  const room = `chipframe-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await openPane(a, "a", room);
    await switchPaneView(a, "a", "canvas");

    // The seed: the labeled connector over the 3px dash line (the data's
    // stand — the frame stands the line's own stand, not the default's).
    const connId = await a.evaluate((c) => {
      const docs = window.__paneDocs;
      const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      let id = "";
      doc.transact(() => {
        const surface = doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: 0, w: 100, h: 60 });
        const sb = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 0, w: 100, h: 60 });
        id = doc.insertBlock(
          "connector",
          { start: { blockId: sa }, end: { blockId: sb }, label: "Label", strokeWidth: 3, strokeStyle: "dash" },
          { parent: surface }
        );
      });
      return id;
    }, "a");

    const chip = a.locator(`[data-connector-label="${connId}"]`);
    await expect(chip).toBeVisible();

    // The 3px dash's stand: the frame's width = the line's effective width
    // (the data's 3), the frame's style = the line's dash stand (the CSS's
    // dashed mapping), the label's padding over the 3px 8px's stand.
    const chipStyle = async () => {
      // The properties are read over the evaluate (the returned plain
      // object): the raw CSSStyleDeclaration's properties are on the
      // prototype, and the non-chromium engines' serialization drops
      // them over the locator's return.
      return chip.evaluate((el) => {
        const s = getComputedStyle(el);
        return {
          width: s.borderTopWidth,
          style: s.borderTopStyle,
          padTop: s.paddingTop,
          padLeft: s.paddingLeft,
        };
      });
    };
    expect(await chipStyle()).toEqual({ width: "3px", style: "dashed", padTop: "3px", padLeft: "8px" });
    // The line's own stand (the width's data follow — the frame's parity).
    const lineWidth = await a.locator(`[data-connector-id="${connId}"]`).getAttribute("stroke-width");
    expect(lineWidth).toBe("3");

    // The strokeStyle's dynamic stand (the data's change stands the
    // frame's style over the wire-less pane's own render).
    await a.evaluate((id) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.updateBlock(id, { strokeStyle: "dot" });
    }, connId);
    await expect.poll(() => chipStyle().then((s) => s.style), SETTLE).toBe("dotted");

    // The solid's 1px stand (the default's return — the lenient render's
    // clamp over the data's stand).
    await a.evaluate((id) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.updateBlock(id, { strokeStyle: "solid", strokeWidth: 1 });
    }, connId);
    await expect.poll(() => chipStyle().then((s) => `${s.width} ${s.style}`), SETTLE).toBe("1px solid");

    // The selection's bump stands the frame too (the frame stands the
    // line's effective width — the selection's bump over the data's 1).
    const mid = await lineMidScreen(a, "a");
    await a.mouse.click(mid.x, mid.y);
    await expect.poll(() => chipStyle().then((s) => s.width), SETTLE).toBe("2px");

    // The endpoint figures' sizes (the marker's stand over the named
    // constants — the arrow's 11 px length + the circle's 4 px radius,
    // the bumped marker sizes over the 8 / the 2.5 defaults).
    const markers = await a.evaluate(() => {
      const doc = document.querySelector(`[data-testid="doc-a"]`)!;
      const defs = doc.querySelector(`[data-slot="docblocks/connector-defs"]`);
      const arrow = defs?.querySelector("marker path") ?? null;
      const arrowMarker = arrow?.closest("marker");
      const circle = defs?.querySelector("marker circle") ?? null;
      const circleMarker = circle?.closest("marker");
      return {
        arrowWidth: arrowMarker?.getAttribute("markerWidth") ?? null,
        arrowViewBox: arrowMarker?.getAttribute("viewBox") ?? null,
        circleR: circle?.getAttribute("r") ?? null,
        circleWidth: circleMarker?.getAttribute("markerWidth") ?? null,
      };
    });
    expect(markers.arrowWidth).toBe("11");
    expect(markers.arrowViewBox).toBe("0 0 11 11");
    // The circle's def (the arrowHead's circle stand — the def's swap).
    await a.evaluate((id) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.updateBlock(id, { arrowHead: "circle" });
    }, connId);
    const circleStand = await a.evaluate(() => {
      const doc = document.querySelector(`[data-testid="doc-a"]`)!;
      const circle = doc.querySelector(`[data-slot="docblocks/connector-defs"] marker circle`);
      const marker = circle?.closest("marker");
      return { r: circle?.getAttribute("r") ?? null, width: marker?.getAttribute("markerWidth") ?? null };
    });
    expect(circleStand.r).toBe("4");
    expect(circleStand.width).toBe("11");
  } finally {
    await context.close();
  }
});
