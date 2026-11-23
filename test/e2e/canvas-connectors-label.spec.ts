// The connector's label chip: the re-anchor drag over the chip stands
// no native text selection (the world's user-select none, the chase
// over the chip's live text), the chip's follow over the re-anchor,
// and the label-edit's regression (the double-click's inline edit
// stands).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasView, toCanvas, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the 15s
// SETTLE's panes + the page loads): the raised budget keeps the timeout
// class out of the loaded machine's flake zone (a true stall stays visible).
test.setTimeout(45_000);

/** Seeds the two seeded shapes (left / right) and returns their ids. The
 *  vertical stand (the boxes stacked at (0, -200) and (0, 150)): the
 *  endpoint handles stand clear of the selected line's toolbar strip (the
 *  toolbar's overlap wins over the handles by the z-order's contract — the
 *  handles stand reachable only off the strip), and the bottom box's south
 *  port (0, 200) stands off the canvas dock's bottom band.
 */
async function seedShapes(
  page: Page,
  client: "a" | "b",
  opts?: { vertical?: boolean }
): Promise<{ left: string; right: string }> {
  return page.evaluate(
    ({ client, vertical }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const left = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(left, vertical ? { x: 0, y: -200, w: 200, h: 100 } : { x: -300, y: -100, w: 200, h: 100 });
      const right = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(right, vertical ? { x: 0, y: 150, w: 200, h: 100 } : { x: 300, y: 100, w: 200, h: 100 });
      return { left, right };
    },
    { client, vertical: opts?.vertical ?? false }
  );
}

/** The connector block between the two shapes (the first direct surface child of the type). */
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
      return {
        variant: block.attrs?.variant as string | undefined,
        start: (block.attrs?.start as { blockId?: string } | undefined)?.blockId,
        end: (block.attrs?.end as { blockId?: string } | undefined)?.blockId,
      };
    },
    { client, id }
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

/** The connector's full endpoint refs (the blockId / the port / the free x-y). */
async function fullEndpointAttrs(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{
  start?: { blockId?: string; port?: string; portT?: number; x?: number; y?: number };
  end?: { blockId?: string; port?: string; portT?: number; x?: number; y?: number };
} | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return null;
      const block = doc.getBlock(id);
      if (block === null || block.type !== "connector") return null;
      const start = (block.attrs?.start ?? undefined) as
        { blockId?: string; port?: string; portT?: number; x?: number; y?: number } | undefined;
      const end = (block.attrs?.end ?? undefined) as
        { blockId?: string; port?: string; portT?: number; x?: number; y?: number } | undefined;
      return { start, end };
    },
    { client, id }
  );
}

/** The real pointer click at the given screen point (a page-level helper). */
async function pageClick(page: Page, x: number, y: number): Promise<void> {
  await page.mouse.click(x, y);
}

test.describe("the connector arrows", () => {
  test("the endpoint's re-anchor drag over the label chip stands no native text selection (the world's user-select none)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "cvs-conn-label-nosel");
    try {
      await toCanvas(a, "a");
      // The vertical stand (the same contract as the endpoint-drag tests):
      // the START handle (the top box's south edge) stands clear of the
      // selected line's toolbar strip (the toolbar wins the overlap zone).
      const { left, right } = await seedShapes(a, "a", { vertical: true });

      // The dock's connector tool + the two endpoint clicks (the shapes'
      // screen centers — the DOM-based stand, the zoom / the pan
      // independent): the START is the top box, the END the bottom box.
      const dock = canvasView(a, "a").getByRole("toolbar", { name: "Canvas tools" });
      await dock.getByLabel("Connector").click();
      const topBox = (await a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${left}"]`).boundingBox())!;
      const bottomBox = (await a
        .locator(`[data-slot="docblocks/canvas-item"][data-block-id="${right}"]`)
        .boundingBox())!;
      await pageClick(a, topBox.x + topBox.width / 2, topBox.y + topBox.height / 2);
      await pageClick(a, bottomBox.x + bottomBox.width / 2, bottomBox.y + bottomBox.height / 2);
      const connId = (await connectorOf(a, "a"))!;
      expect(connId).not.toBeNull();
      const attrs = await connectorAttrs(a, "a", connId);
      expect(attrs?.start).toBe(left); // the block refs stand (the clicks hit the shapes)
      expect(attrs?.end).toBe(right);

      // The label stands on the chip (the midpoint): the label is set via
      // updateBlock (one doc write).
      await a.evaluate(
        ({ id, label }) => {
          const doc = window.__paneDocs?.a;
          if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
          doc.updateBlock(id, { label });
        },
        { id: connId, label: "Label" }
      );

      // The line's click selects it: the START endpoint handle stands.
      const mid = await lineMid(a, "a", connId);
      await a.mouse.click(mid.x, mid.y);
      const startHandle = a.locator(
        `[data-connector-endpoint="start"][data-connector-endpoint-id="${connId}"] circle:nth-child(2)`
      );
      await expect(startHandle).toHaveCount(1);

      // The START handle stands reachable (the press stands the session —
      // the element-from-point probe: the handle's hit circle is under the
      // point, not the toolbar's strip).
      const handleBox = (await startHandle.boundingBox())!;
      const handleCenter = { x: handleBox.x + handleBox.width / 2, y: handleBox.y + handleBox.height / 2 };
      const underHandle = await a.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el !== null && el.closest("[data-connector-endpoint]") !== null;
      }, handleCenter);
      expect(underHandle).toBe(true);

      // The label chip stands at the line's midpoint: its initial screen
      // position (the drag's path crosses the chip's text zone — the chip
      // follows the line mid-drag, so the chase stands the live seat).
      const labelChip = a.locator(`[data-connector-label="${connId}"]`);
      await expect(labelChip).toHaveCount(1);
      const chipBox = (await labelChip.boundingBox())!;
      const chipCenter = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };

      // The re-anchor drag: the mouse stands at the START handle, passes
      // over the label chip (the chip's text zone), and releases over the
      // bottom box (the re-anchor to the bottom block). The drag stands the
      // native text selection over the chip's text — the world layer's
      // user-select none (the shared drag session's stand) suppresses it.
      await a.mouse.move(handleCenter.x, handleCenter.y);
      await a.mouse.down();
      await a.mouse.move(chipCenter.x, chipCenter.y, { steps: 12 });
      // Mid-drag (the first stand): the world layer's user-select stands
      // none (the drag session's stand).
      const midDragStand = await a.evaluate(() => {
        const world = document.querySelector('[data-slot="docblocks/canvas-world"]');
        return world !== null ? getComputedStyle(world).userSelect : null;
      });
      expect(midDragStand).toBe("none");

      // The chase: the chip follows the line (the midpoint), so the mouse
      // stands over the chip's LIVE text (each step halves the gap). The
      // element-from-point probe stands the reach (the chip's text zone is
      // under the mouse) — the meaningful stand of the no-selection check.
      let chasePoint = { x: chipCenter.x, y: chipCenter.y };
      for (let i = 0; i < 4; i++) {
        const live = (await labelChip.boundingBox())!;
        chasePoint = { x: live.x + live.width / 2, y: live.y + live.height / 2 };
        await a.mouse.move(chasePoint.x, chasePoint.y, { steps: 4 });
      }
      // The over-chip probe (the meaningful stand of the no-selection
      // check): the mouse point stands inside the chip's live rect (the
      // chip's text zone under the mouse). The element-from-point probe is
      // unsuitable here: the endpoint's handle (the cursor-follower) stands
      // over the world's layer (the z-order) — its hit circle masks the
      // chip under the point.
      const overChip = await a.evaluate(
        ({ x, y, cid }) => {
          const chip = document.querySelector<HTMLElement>(`[data-connector-label="${cid}"]`);
          if (chip === null) return { overChip: false, selection: "" };
          const r = chip.getBoundingClientRect();
          return {
            overChip: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
            selection: window.getSelection()?.toString() ?? "",
          };
        },
        { ...chasePoint, cid: connId }
      );
      expect(overChip.overChip).toBe(true);
      expect(overChip.selection).toBe("");

      // The release: over the bottom box's north edge (the edge's snap —
      // the re-anchor to the bottom block's port; the release stands the
      // block's ref only over the edge's snap, a center's release stands
      // the free point).
      await a.mouse.move(bottomBox.x + bottomBox.width / 2, bottomBox.y, { steps: 8 });
      await a.mouse.up();

      // After the release: the native selection stands EMPTY (no selection
      // lingers over the chip's text).
      const afterSelection = await a.evaluate(() => window.getSelection()?.toString() ?? "");
      expect(afterSelection).toBe("");

      // The re-anchor commit: the START endpoint is updated (the bottom
      // block's ref), the label is NOT touched (the label stands).
      await expect
        .poll(async () => fullEndpointAttrs(a, "a", connId), SETTLE)
        .toEqual(expect.objectContaining({ start: expect.objectContaining({ blockId: right }) }));
      const label = await a.evaluate((id) => {
        const block = window.__paneDocs?.a?.getBlock(id);
        return block?.attrs?.label as string | undefined;
      }, connId);
      expect(label).toBe("Label");

      // The label chip stands (the display is intact — the chip is not
      // removed / highlighted). The chip's seat has moved (the re-anchor's
      // midpoint): its current screen position.
      await expect(labelChip).toHaveCount(1);
      await expect(labelChip).toContainText("Label");

      // The label-edit's regression: the double-click's inline edit stands
      // (the world's user-select none stands off over the edit session — the
      // edit's text is selectable / editable).
      const chipBoxAfter = (await labelChip.boundingBox())!;
      await a.mouse.dblclick(chipBoxAfter.x + chipBoxAfter.width / 2, chipBoxAfter.y + chipBoxAfter.height / 2);
      const editInput = a.locator('[data-slot="docblocks/connector-label-edit"]');
      await expect(editInput).toHaveCount(1);
    } finally {
      await close();
    }
  });
});
