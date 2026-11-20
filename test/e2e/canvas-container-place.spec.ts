// The canvas container (the reworked group)'s dock's container tool:
// the click's default-size place and the drag-to-size's place — the
// group's box stands in both panes over the wire.
import { expect, test } from "@playwright/test";

import { docBlocks, dock } from "./canvas-container-scene";
import { SETTLE, canvasCenter, screenAt, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the place", () => {
  test("the dock's container tool: the click's default-size place over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-place");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The dock's container tool (the click's default-size place).
      await dock(a, "a").getByLabel("Container").click();
      const center = await canvasCenter(a, "a");
      await a.mouse.click(center.x + 10, center.y - 10);
      // A group with the default 240x160 box at the click point stands in
      // both panes over the wire.
      await expect
        .poll(async () => {
          const blocks = await docBlocks(b, "b");
          const groups = Object.values(blocks).filter((block) => block.type === "group");
          return groups.length;
        }, SETTLE)
        .toBe(1);
      const blocksB = await docBlocks(b, "b");
      const group = Object.values(blocksB).find((block) => block.type === "group")!;
      expect(group.geometry).toEqual({ x: 10, y: -10, w: 240, h: 160 });
      expect(group.attrs?.members).toEqual([]);
    } finally {
      await close();
    }
  });

  test("the dock's container tool: the drag-to-size place over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-size");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await dock(a, "a").getByLabel("Container").click();
      const center = await canvasCenter(a, "a");
      // The drag-to-size: a +80/+50 canvas box (100% zoom), the center at
      // the drag's midpoint.
      const from = screenAt(center, -40, -25);
      const to = screenAt(center, 40, 25);
      await a.mouse.move(from.x, from.y);
      await a.mouse.down();
      await a.mouse.move(to.x, to.y, { steps: 4 });
      await a.mouse.up();
      await expect
        .poll(async () => {
          const blocks = await docBlocks(b, "b");
          const groups = Object.values(blocks).filter((block) => block.type === "group");
          return groups.length;
        }, SETTLE)
        .toBe(1);
      const blocksB = await docBlocks(b, "b");
      const group = Object.values(blocksB).find((block) => block.type === "group")!;
      expect(group.geometry).toEqual({ x: 0, y: 0, w: 80, h: 50 });
    } finally {
      await close();
    }
  });
});
