// The connector's options toolbar (the selected line's menu) stands the
// circles) and the world layer. When the menu overlaps an endpoint's zone
// connector endpoint spec (the handles keep their stand there).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, toCanvas, twoPanes } from "./helpers";

/** The connector block between the surface's shapes (the first such child). */
async function connectorOf(page: Page, client: "a" | "b"): Promise<string | null> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      if (surfaceId === undefined) return null;
      const surface = json.blocks[surfaceId];
      if (surface === undefined) return null;
      const connectorId = surface.children?.find((id: string) => json.blocks[id]?.type === "connector");
      return connectorId ?? null;
    },
    { client }
  );
}

/** The line's screen midpoint (the hit path's bbox center). */
async function lineMid(page: Page, client: "a" | "b", id: string): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ client, id }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      const path = view.querySelector<SVGPathElement>(`[data-connector-id="${id}"]`);
      if (path === null) throw new Error("the connector line is missing");
      const box = path.getBBox();
      const viewBox = view.getBoundingClientRect();
      return {
        x: viewBox.left + viewBox.width / 2 + (box.x + box.width / 2),
        y: viewBox.top + viewBox.height / 2 + (box.y + box.height / 2),
      };
    },
    { client, id }
  );
}

async function connectorAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ variant?: string; start?: string; end?: string } | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      return { variant: block.attrs?.variant as string | undefined };
    },
    { client, id }
  );
}

/** The screen position of the connector's endpoint handle circle (its center). */
async function endpointScreen(
  page: Page,
  client: "a" | "b",
  id: string,
  which: "start" | "end"
): Promise<{ x: number; y: number } | null> {
  return page.evaluate(
    ({ client, id, which }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) return null;
      const circle = view.querySelector<SVGCircleElement>(
        `[data-connector-endpoint="${which}"][data-connector-endpoint-id="${id}"] circle:nth-child(2)`
      );
      if (circle === null) return null;
      const r = circle.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    },
    { client, id, which }
  );
}

/** The topmost element at a screen point (what a click there would hit). */
async function topmostAt(page: Page, x: number, y: number): Promise<{ isHandle: boolean; isToolbar: boolean } | null> {
  return page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (el === null) return null;
      return {
        isHandle: el.tagName === "circle" && el.closest('[data-slot="docblocks/connector-handles"]') !== null,
        isToolbar: el.closest('[data-slot="docblocks/connector-toolbar"]') !== null,
      };
    },
    { x, y }
  );
}

test("the connector's options toolbar stands over its endpoint handles (the menu over the ports)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "cvs-conn-zorder");
  try {
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    // Two shapes stacked vertically with a gap, so the line's midpoint
    // toolbar (offset above the midpoint) overlaps the TOP endpoint (the
    // start, the top shape's south port) but not the bottom one.
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === undefined || doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId =
        Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0] ?? doc.insertBlock("surface");
      const top = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
      doc.setGeometry(top, { x: 0, y: -90, w: 120, h: 60 });
      const bottom = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
      doc.setGeometry(bottom, { x: 0, y: 90, w: 120, h: 60 });
      doc.insertBlock(
        "connector",
        { start: { blockId: top, port: "south" }, end: { blockId: bottom, port: "north" } },
        { parent: surfaceId }
      );
    });
    const connId = (await connectorOf(a, "a"))!;
    // The line's click selects it: the toolbar + the endpoint handles stand.
    const mid = await lineMid(a, "a", connId);
    await a.mouse.click(mid.x, mid.y);
    const toolbar = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/connector-toolbar"]`);
    await expect(toolbar).toBeVisible();
    const startHandle = a.locator(
      `[data-connector-endpoint="start"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
    );
    await expect(startHandle).toHaveCount(1);

    // The START (top) endpoint — the overlap zone: the toolbar stands over
    // the handle (the port is hidden under the menu; a click there hits the
    // menu, not the port).
    const start = (await endpointScreen(a, "a", connId, "start"))!;
    const topAtStart = await topmostAt(a, start.x, start.y);
    expect(topAtStart?.isToolbar).toBe(true);
    expect(topAtStart?.isHandle).toBe(false);

    // The END (bottom) endpoint — no overlap: the handle stands over the
    // world (the port is visible and clickable — the re-anchor's stand).
    const end = (await endpointScreen(a, "a", connId, "end"))!;
    const topAtEnd = await topmostAt(a, end.x, end.y);
    expect(topAtEnd?.isHandle).toBe(true);
    expect(topAtEnd?.isToolbar).toBe(false);

    // The menu is interactive: a pick commits over the wire (the variant
    // stands on the other pane), not a port press.
    await toolbar.getByLabel("Orthogonal line").click();
    await expect
      .poll(async () => connectorAttrs(b, "b", connId), SETTLE)
      .toEqual(expect.objectContaining({ variant: "orthogonal" }));
  } finally {
    await close();
  }
});
