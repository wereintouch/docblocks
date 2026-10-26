import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The edge anchors: the connector
// endpoint stands on a side at the fractional position along it (the
// `portT` — the continuous anchor). The seeded position stands in the
// line's geometry over the wire; the endpoint handle's drag along the
// edge re-anchors it at the release's projection (one updateBlock, the
// other pane follows, the undo reverts); the press-drag draw's press on
// the edge commits the side + the position.
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

/** The seeded scene: the two boxes (the canvas-connectors spec's
 * geometry: left (−300, −100, 200x100), right (300, 100, 200x100)). */
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
      doc.setGeometry(left, { x: -300, y: -100, w: 200, h: 100 });
      const right = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(right, { x: 300, y: 100, w: 200, h: 100 });
      return { left, right };
    },
    { client }
  );
}

async function seedConnector(page: Page, client: "a" | "b", attrs: Record<string, unknown>): Promise<string> {
  return page.evaluate(
    ({ client, attrs }) => {
      const doc = window.__paneDocs?.[client] ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      if (surfaceId === undefined) throw new Error("the surface is missing");
      return doc.insertBlock("connector", attrs, { parent: surfaceId });
    },
    { client, attrs }
  );
}

const lineD = (page: Page, client: "a" | "b", id: string) =>
  page.locator(`[data-testid="doc-${client}"] [data-connector-id="${id}"]`).getAttribute("d");

async function endpointAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ start?: { blockId?: string; port?: string; portT?: number; x?: number; y?: number } } | null> {
  return page.evaluate(
    ({ client, id }) => {
      const doc = window.__paneDocs?.[client] ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      return {
        start: (block.attrs?.start ?? undefined) as
          { blockId?: string; port?: string; portT?: number; x?: number; y?: number } | undefined,
      };
    },
    { client, id }
  );
}

test.describe("the edge anchors", () => {
  test("the seeded portT stands the line's geometry over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-edge-anchors");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      const connId = await seedConnector(a, "a", {
        start: { blockId: left, port: "north", portT: 0.25 },
        end: { blockId: right, port: "south" },
        variant: "straight",
      });
      // Left box (−300, −100, 200x100): the north edge at y = −150, t =
      // 0.25 stands at x = −400 + 0.25 * 200 = −350. The line's M point
      // is the edge's point — in both panes (the attr syncs over the
      // wire).
      await expect.poll(async () => (await lineD(a, "a", connId))!.startsWith("M -350 -150"), SETTLE).toBe(true);
      await expect.poll(async () => (await lineD(b, "b", connId))!.startsWith("M -350 -150"), SETTLE).toBe(true);
      const endAttrs = await endpointAttrs(b, "b", connId);
      expect(endAttrs?.start).toEqual({ blockId: left, port: "north", portT: 0.25 });
    } finally {
      await close();
    }
  });

  test("the endpoint's drag along the edge re-anchors at the release's projection (one undo; the other pane follows)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "cvs-edge-anchors-drag");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { left, right } = await seedShapes(a, "a");
      const connId = await seedConnector(a, "a", {
        start: { blockId: left, port: "north", portT: 0.25 },
        end: { blockId: right, port: "south" },
        variant: "straight",
      });
      const center = await canvasCenter(a, "a");
      // The line's click selects it: the endpoint handles stand.
      const mid = { x: center.x - 25, y: center.y }; // the line's midpoint (−350,−150)→(300,150)
      await a.mouse.click(mid.x, mid.y);
      const startHandle = a.locator(
        `[data-connector-endpoint="start"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );
      await expect(startHandle).toHaveCount(1);

      // The drag along the north edge: from the anchor (−350, −150) to
      // (−250, −150) — the t = 0.75 projection (the left edge's start
      // corner is x = −400: (−250 − (−400)) / 200). Mid-drag 6px off the
      // edge the line sticks to the edge's point (the snap's live
      // effect).
      const handleBox = (await startHandle.boundingBox())!;
      const stick = { x: center.x - 300, y: center.y - 156 };
      const to = { x: center.x - 250, y: center.y - 150 };
      await a.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
      await a.mouse.down();
      await a.mouse.move(stick.x, stick.y, { steps: 6 });
      const stuckD = (await lineD(a, "a", connId))!;
      expect(stuckD.startsWith("M -300 -150")).toBe(true); // the stick
      await expect(a.locator(`[data-connector-snap-badge="${connId}"]`)).toHaveCount(1);
      await a.mouse.move(to.x, to.y, { steps: 6 });
      await a.mouse.up();

      // The commit: the side + the release's projection (the t = 0.75),
      // one wire update — the other pane's line stands from the same
      // attr.
      await expect
        .poll(async () => endpointAttrs(a, "a", connId), SETTLE)
        .toEqual({
          start: { blockId: left, port: "north", portT: 0.75 },
        });
      await expect
        .poll(async () => endpointAttrs(b, "b", connId), SETTLE)
        .toEqual({ start: { blockId: left, port: "north", portT: 0.75 } });
      await expect.poll(async () => (await lineD(b, "b", connId))!.startsWith("M -250 -150"), SETTLE).toBe(true);

      // The undo reverts the re-anchor (the t stands back to 0.25).
      await a.keyboard.press("Escape");
      await canvasView(a, "a").focus();
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => endpointAttrs(a, "a", connId), SETTLE)
        .toEqual({ start: { blockId: left, port: "north", portT: 0.25 } });
    } finally {
      await close();
    }
  });

  test("the press-drag draw's press on the edge commits the side + the position (the free end)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-edge-anchors-draw");
    try {
      await toCanvas(a, "a");
      await seedShapes(a, "a");
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const center = await canvasCenter(a, "a");
      // The press on the left box's north edge at the t = 0.75 point
      // (x = −250, 2px inside the box — the exact-edge press can miss
      // the item's fill at the sub-pixel boundary), the drag to the
      // empty canvas (off the page miniature's card — a release on the
      // card stands the root's ref, the commit guard drops it): the
      // press inside the edge's snap band stands the free point at the
      // snapped edge point + the frozen side (the continuous-edge stand
      // — no block ref), the end stands the free point.
      const from = { x: center.x - 250, y: center.y - 148 };
      // The release inside the container (the view's box ~808x596 — the
      // canvas x ∈ [−404, 404], y ∈ [−298, 298] against the center): an
      // off-screen release stands no pointerup over the container.
      const to = { x: center.x - 390, y: center.y + 250 };
      await a.mouse.move(from.x, from.y);
      await a.mouse.down();
      await a.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
      await a.mouse.move(to.x, to.y, { steps: 8 });
      await a.mouse.up();
      const id = (await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) return null;
        const entry = Object.entries(doc.toJSON().blocks).find(([, block]) => block.type === "connector")?.[0];
        return entry ?? null;
      }))!;
      expect(id).not.toBeNull();
      const attrs = await endpointAttrs(a, "a", id);
      expect(attrs?.start).toEqual({ x: -250, y: -150, port: "north" });
    } finally {
      await close();
    }
  });
});
