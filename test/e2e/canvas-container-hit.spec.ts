// The canvas container (the reworked group)'s hit: the border's press
// (the figures stand z-above), the EMPTY-interior's press (the marquee
// stands off the container), a member UNDER the container (the z-order's
// stand, the border's hit band is the ring only), and the Escape's
// drill-up (the member's container stands selected, nothing is written).
import { expect, test } from "@playwright/test";

import { docBlocks, groupMembers, seedScene } from "./canvas-container-scene";
import { SETTLE, canvasCenter, canvasView, outCount, screenAt, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the hit", () => {
  test("the border's press selects the container; the figure's press stands the figure", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "container-select");
    try {
      await toCanvas(a, "a");
      const { group, inside } = await seedScene(a, "a");
      const center = await canvasCenter(a, "a");
      // The container's border (the top edge): the press selects the
      // container (the data-selected on the positioned item).
      const blocks = await docBlocks(a, "a");
      const borderPoint = screenAt(
        center,
        blocks[group]!.geometry!.x,
        blocks[group]!.geometry!.y - blocks[group]!.geometry!.h / 2
      );
      await a.mouse.click(borderPoint.x, borderPoint.y);
      const groupWrapper = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${group}"]`);
      expect(await groupWrapper.getAttribute("data-selected")).not.toBeNull();
      // The member's center (z-above the container's interior): the press
      // selects the FIGURE, not the container.
      const insideCenter = screenAt(center, blocks[inside]!.geometry!.x, blocks[inside]!.geometry!.y);
      await a.mouse.click(insideCenter.x, insideCenter.y);
      const figureWrapper = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${inside}"]`);
      expect(await figureWrapper.getAttribute("data-selected")).not.toBeNull();
      // The container stands deselected (the figure took the selection).
      expect(await groupWrapper.getAttribute("data-selected")).toBeNull();
    } finally {
      await close();
    }
  });

  test("the EMPTY-interior press selects the container; the figure's press stands the figure (the marquee stands off the container)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "container-interior");
    try {
      await toCanvas(a, "a");
      // Seed the container AWAY from the page miniature (the root's page
      // card, 720x960 at the canvas center, covers x in [-360, 360]): the
      // empty-interior press must land on the empty canvas, not the page
      // card (which keeps its own two-click contract). The container at
      // x=500 stands clear.
      const { group, inside } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId =
          Object.entries(json.blocks).find(([, block]) => (block as { type: string }).type === "surface")?.[0] ??
          doc.insertBlock("surface");
        const group = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(group, { x: 500, y: 0, w: 240, h: 160 });
        const inside = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
        doc.setGeometry(inside, { x: 460, y: 0, w: 80, h: 60 });
        doc.transact(() => {
          doc.updateBlock(group, { members: [inside] });
        });
        return { group, inside };
      });
      const blocks = await docBlocks(a, "a");
      // The member (at (460, 0) 80x60) occupies x in [420, 500]. The empty
      // interior spot (560, 0) is inside the container's box (x in [380, 620])
      // and clear of the figure and the page card (the root's page miniature,
      // 720 wide at the center, stands x in [-360, 360] — the spot stands
      // clear of it). Zoom out to 50% so the far container stands inside the
      // view's visible area (the 100% frame clips it).
      const zoomToolbar = a.getByRole("toolbar", { name: "Canvas zoom" });
      for (let i = 0; i < 5; i += 1) {
        await zoomToolbar.getByLabel("Zoom out").click();
      }
      const zoomLabel = await zoomToolbar.getByLabel("Reset zoom").textContent();
      expect(zoomLabel).toBe("50%");
      const zoom = parseInt(zoomLabel ?? "0", 10) / 100;
      const cvBox = await canvasCenter(a, "a");
      const screen = {
        empty: { x: cvBox.x + 560 * zoom, y: cvBox.y },
        figure: { x: cvBox.x + blocks[inside]!.geometry!.x * zoom, y: cvBox.y + blocks[inside]!.geometry!.y * zoom },
      };
      await a.mouse.click(screen.empty.x, screen.empty.y);
      const groupWrapper = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${group}"]`);
      expect(await groupWrapper.getAttribute("data-selected")).not.toBeNull();
      // The figure's press stands the FIGURE (the interior is pointer-
      // transparent — the figure's element catches the press).
      await a.mouse.click(screen.figure.x, screen.figure.y);
      const figureWrapper = a.locator(`[data-slot="docblocks/canvas-item"][data-block-id="${inside}"]`);
      expect(await figureWrapper.getAttribute("data-selected")).not.toBeNull();
      // The container stands deselected (the figure took the selection).
      expect(await groupWrapper.getAttribute("data-selected")).toBeNull();
    } finally {
      await close();
    }
  });

  test("a member UNDER the container (z-order) still selects and drags out (the border's hit band is the ring only)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-under-z");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed the member FIRST (so it stands under the group in z-order),
      // then the container over it, then make the member a member.
      const { group, member } = await a.evaluate(() => {
        const docs = window.__paneDocs;
        const doc = docs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const member = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(member, { x: 100, y: 0, w: 80, h: 60 });
        const group = doc.insertBlock("group", { members: [member] }, { parent: surface });
        doc.setGeometry(group, { x: 120, y: 0, w: 240, h: 160 });
        return { group, member };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      expect(await groupMembers(b, "b", group)).toContain(member);
      const center = await canvasCenter(a, "a");
      // The member's center (fully inside the container's interior, under the
      // group in z): the press stands the MEMBER (the interior is
      // pointer-transparent — the border's hit band is the ring only).
      const figCenter = screenAt(center, 100, 0);
      await a.mouse.click(figCenter.x, figCenter.y);
      const memberSelected = await a.evaluate(
        ({ member }) =>
          document
            .querySelector(`[data-slot="docblocks/canvas-item"][data-block-id="${member}"]`)
            ?.hasAttribute("data-selected") ?? false,
        { member }
      );
      const groupSelected = await a.evaluate(
        ({ group }) =>
          document
            .querySelector(`[data-slot="docblocks/canvas-item"][data-block-id="${group}"]`)
            ?.hasAttribute("data-selected") ?? false,
        { group }
      );
      expect(memberSelected).toBe(true);
      expect(groupSelected).toBe(false);
      // Drag the under-z member out of the container (the red stand, the
      // release leaves the container over the wire).
      await a.mouse.move(figCenter.x, figCenter.y);
      await a.mouse.down();
      const figEnd = screenAt(center, -180, 0);
      await a.mouse.move(figEnd.x, figEnd.y, { steps: 6 });
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]').count())
        .toBe(1);
      await a.mouse.up();
      await expect.poll(async () => (await groupMembers(b, "b", group)).includes(member), SETTLE).toBe(false);
    } finally {
      await close();
    }
  });

  test("the Escape drills up: the member's container stands selected, nothing is written", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "container-esc-parent");
    try {
      await toCanvas(a, "a");
      const { group, inside } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(a, "a"))[group] !== undefined, SETTLE).toBe(true);
      const center = await canvasCenter(a, "a");
      const blocks = await docBlocks(a, "a");
      const memberPoint = screenAt(center, blocks[inside]!.geometry!.x, blocks[inside]!.geometry!.y);
      // Select the member (the press's own zone), then Escape: the container
      // stands selected — a local view state's step (the wire stands).
      await a.mouse.click(memberPoint.x, memberPoint.y);
      const groupItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${group}"]`);
      const memberItem = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${inside}"]`);
      expect(await memberItem.getAttribute("data-selected")).not.toBeNull();
      const outs = await outCount(a, "a");
      await a.keyboard.press("Escape");
      expect(await groupItem.getAttribute("data-selected")).not.toBeNull();
      expect(await memberItem.getAttribute("data-selected")).toBeNull();
      // No wire update stands from the Escape (one more Escape over the
      // container's own stands the clear — still no write).
      await a.keyboard.press("Escape");
      expect(await groupItem.getAttribute("data-selected")).toBeNull();
      expect(await outCount(a, "a")).toBe(outs);
    } finally {
      await close();
    }
  });
});
