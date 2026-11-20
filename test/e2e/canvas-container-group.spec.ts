// The canvas container (the reworked group)'s group ops: the
// Ctrl/Cmd+G's group (the wire's one update, the box in both panes) +
// the Ctrl/Cmd+Shift+G's dissolve, the resize handles (the box grows,
// the center re-derives, the member stands where it is), and the
// delete (the members stand).
import { expect, test } from "@playwright/test";

import { docBlocks, seedScene } from "./canvas-container-scene";
import { SETTLE, canvasCenter, canvasView, screenAt, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the group's ops", () => {
  test("the Ctrl/Cmd+G groups the selection (the wire's one update, the box in both panes); the Ctrl/Cmd+Shift+G dissolves", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-hotkeys");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed two free shapes (no group) on pane A.
      const { sa, sb } = await a.evaluate(() => {
        const docs = window.__paneDocs;
        const doc = docs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const sa = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(sa, { x: -100, y: -50, w: 100, h: 60 });
        const sb = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
        doc.setGeometry(sb, { x: 100, y: 50, w: 80, h: 60 });
        return { sa, sb };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[sa] !== undefined, SETTLE).toBe(true);
      const center = await canvasCenter(a, "a");
      // The selection: the a's click + the b's shift-click (the real
      // keyboard's Shift — the Playwright's mouse modifiers do not reach
      // the pointerdown).
      const aStart = screenAt(center, -100, -50);
      const bStart = screenAt(center, 100, 50);
      await a.mouse.click(aStart.x, aStart.y);
      await a.keyboard.down("Shift");
      await a.mouse.click(bStart.x, bStart.y);
      await a.keyboard.up("Shift");
      // The group's hotkey: one transact (the group block with the members
      // + its own box) over the wire to pane B.
      await a.keyboard.press("Control+g");
      const blocksA = await docBlocks(a, "a");
      const groupA = Object.values(blocksA).find((block) => block.type === "group")!;
      expect(groupA.attrs?.members).toEqual([sa, sb]);
      await expect
        .poll(async () => {
          const blocks = await docBlocks(b, "b");
          return Object.values(blocks).find((block) => block.type === "group")?.attrs?.members as string[] | undefined;
        }, SETTLE)
        .toEqual([sa, sb]);
      // The dissolve hotkey (the selected group stands after the creation):
      // Ctrl/Cmd+Shift+G removes the group, the members stand.
      await a.keyboard.press("Control+Shift+g");
      await expect
        .poll(
          async () => Object.values(await docBlocks(a, "a")).filter((block) => block.type === "group").length,
          SETTLE
        )
        .toBe(0);
      await expect
        .poll(
          async () => Object.values(await docBlocks(b, "b")).filter((block) => block.type === "group").length,
          SETTLE
        )
        .toBe(0);
      const after = await docBlocks(a, "a");
      expect(after[sa]?.type).toBe("shape");
      expect(after[sb]?.type).toBe("shape");
    } finally {
      await close();
    }
  });

  test("the resize handles grow the box (the center re-derives); the member stands where it is", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-resize");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, inside } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const before = await docBlocks(a, "a");
      const groupBefore = before[group]!;
      const insideBefore = before[inside]!;
      // Select the container (the border's press) — the eight handles stand.
      const center = await canvasCenter(a, "a");
      const borderPoint = screenAt(
        center,
        groupBefore.geometry!.x,
        groupBefore.geometry!.y - groupBefore.geometry!.h / 2
      );
      await a.mouse.click(borderPoint.x, borderPoint.y);
      const handles = canvasView(a, "a").locator('[data-slot="docblocks/canvas-handles"]');
      expect(await handles.count()).toBe(1);
      // The e handle stands at the east edge; a +40px screen drag at 100%
      // is +40 canvas (the width grows by 40, the center re-derives by +20).
      const eHandle = handles.locator('[data-handle="e"]');
      const box = (await eHandle.boundingBox())!;
      const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await a.mouse.move(start.x, start.y);
      await a.mouse.down();
      await a.mouse.move(start.x + 40, start.y, { steps: 6 });
      await a.mouse.up();
      // The box's width stands the +40 (the center's x re-derives by +20);
      // the member's geometry stands untouched (the resize is the box only).
      await expect
        .poll(async () => (await docBlocks(a, "a"))[group]?.geometry, SETTLE)
        .toEqual({
          x: groupBefore.geometry!.x + 20,
          y: groupBefore.geometry!.y,
          w: groupBefore.geometry!.w + 40,
          h: groupBefore.geometry!.h,
        });
      const after = await docBlocks(a, "a");
      expect(after[inside]?.geometry).toEqual(insideBefore.geometry);
      await expect
        .poll(async () => (await docBlocks(b, "b"))[group]?.geometry, SETTLE)
        .toEqual({
          x: groupBefore.geometry!.x + 20,
          y: groupBefore.geometry!.y,
          w: groupBefore.geometry!.w + 40,
          h: groupBefore.geometry!.h,
        });
    } finally {
      await close();
    }
  });

  test("the delete: the container goes, the members stand (both panes)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-delete");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, inside, outside } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const center = await canvasCenter(a, "a");
      const blocks = await docBlocks(a, "a");
      const borderPoint = screenAt(
        center,
        blocks[group]!.geometry!.x,
        blocks[group]!.geometry!.y - blocks[group]!.geometry!.h / 2
      );
      // Select the container (the border's press).
      await a.mouse.click(borderPoint.x, borderPoint.y);
      await a.keyboard.press("Delete");
      // The container goes (over the wire), the members stand.
      await expect.poll(async () => (await docBlocks(b, "b"))[group], SETTLE).toBeUndefined();
      const blocksB = await docBlocks(b, "b");
      expect(blocksB[inside]?.type).toBe("shape");
      expect(blocksB[outside]?.type).toBe("shape");
    } finally {
      await close();
    }
  });
});
