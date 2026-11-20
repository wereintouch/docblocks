// The canvas container (the reworked group)'s membership: the
// drag-in / drag-out (the green / red stand, the release's one transact
// over the wire), the container's move (the box + the members), and
// the between-container's move (the member leaves the old and joins
// the new).
import { expect, test } from "@playwright/test";

import { docBlocks, groupMembers, seedScene } from "./canvas-container-scene";
import { SETTLE, canvasCenter, screenAt, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the membership", () => {
  test("the drag-in: the green stand, the release joins the container over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-dragin");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, outside } = await seedScene(a, "a");
      // Seed pane B too (the wire's parity for the membership read).
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const center = await canvasCenter(a, "a");
      // Select the outside figure (a no-op press at its center).
      const figStart = screenAt(center, -160, 0);
      await a.mouse.click(figStart.x, figStart.y);
      // Drag the figure into the container's box (the figure's box fully
      // inside the container's box).
      await a.mouse.move(figStart.x, figStart.y);
      await a.mouse.down();
      const figEnd = screenAt(center, 120, 0);
      await a.mouse.move(figEnd.x, figEnd.y, { steps: 6 });
      // The green drop indicator stands over the figure.
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release joins the container (over the wire to pane B).
      await expect.poll(async () => (await groupMembers(b, "b", group)).includes(outside), SETTLE).toBe(true);
      // The figure's geometry stands the drag's landing.
      const blocksA = await docBlocks(a, "a");
      expect(blocksA[outside]?.geometry).toEqual({ x: 120, y: 0, w: 80, h: 60 });
    } finally {
      await close();
    }
  });

  test("the drag-out: the red stand, the release leaves the container over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-dragout");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, inside } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      // The member stands in the container at seed.
      expect(await groupMembers(b, "b", group)).toContain(inside);
      const center = await canvasCenter(a, "a");
      // Select the member (a press at its center — the member, not the
      // container).
      const figStart = screenAt(center, 100, 0);
      await a.mouse.click(figStart.x, figStart.y);
      // Drag the member out of the container's box (fully outside).
      await a.mouse.move(figStart.x, figStart.y);
      await a.mouse.down();
      const figEnd = screenAt(center, -180, 0);
      await a.mouse.move(figEnd.x, figEnd.y, { steps: 6 });
      // The red drop indicator stands over the member.
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release leaves the container (over the wire to pane B).
      await expect.poll(async () => (await groupMembers(b, "b", group)).includes(inside), SETTLE).toBe(false);
    } finally {
      await close();
    }
  });

  test("the container's move: the box and the members stand the delta over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-move");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group, inside } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const before = await docBlocks(a, "a");
      const groupBefore = before[group]!;
      const insideBefore = before[inside]!;
      const center = await canvasCenter(a, "a");
      // Press the container's border (the top edge, the box's center-x) to
      // start the move (the interior is pointer-transparent — the border is
      // the press target).
      const borderPoint = screenAt(
        center,
        groupBefore.geometry!.x,
        groupBefore.geometry!.y - groupBefore.geometry!.h / 2
      );
      await a.mouse.move(borderPoint.x, borderPoint.y);
      await a.mouse.down();
      await a.mouse.move(borderPoint.x + 40, borderPoint.y + 20, { steps: 4 });
      await a.mouse.up();
      // The container's box + the member stand the +40/+20 delta (over the
      // wire to pane B).
      await expect
        .poll(async () => (await docBlocks(b, "b"))[group]?.geometry, SETTLE)
        .toEqual({
          x: groupBefore.geometry!.x + 40,
          y: groupBefore.geometry!.y + 20,
          w: groupBefore.geometry!.w,
          h: groupBefore.geometry!.h,
        });
      await expect
        .poll(async () => (await docBlocks(b, "b"))[inside]?.geometry, SETTLE)
        .toEqual({
          x: insideBefore.geometry!.x + 40,
          y: insideBefore.geometry!.y + 20,
          w: insideBefore.geometry!.w,
          h: insideBefore.geometry!.h,
        });
    } finally {
      await close();
    }
  });

  test("the between-container move: the member leaves the old and joins the new over the wire", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-between");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed two containers (A on the left, B on the right) and a member
      // fully inside A.
      const { aGroup, bGroup, member } = await a.evaluate(() => {
        const docs = window.__paneDocs;
        const doc = docs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId = Object.entries(json.blocks).find(
          ([, block]) => (block as { type: string }).type === "surface"
        )?.[0];
        const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
        const aGroup = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(aGroup, { x: -120, y: 0, w: 200, h: 160 });
        const bGroup = doc.insertBlock("group", { members: [] }, { parent: surface });
        doc.setGeometry(bGroup, { x: 120, y: 0, w: 200, h: 160 });
        const member = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
        doc.setGeometry(member, { x: -120, y: 0, w: 60, h: 40 });
        doc.transact(() => {
          doc.updateBlock(aGroup, { members: [member] });
        });
        return { aGroup, bGroup, member };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[aGroup] !== undefined, SETTLE).toBe(true);
      // The member stands in A at seed.
      expect(await groupMembers(b, "b", aGroup)).toContain(member);
      expect(await groupMembers(b, "b", bGroup)).not.toContain(member);
      const center = await canvasCenter(a, "a");
      // Select the member (a press at its center) and drag it into B's box
      // (fully inside B, outside A).
      const figStart = screenAt(center, -120, 0);
      await a.mouse.click(figStart.x, figStart.y);
      await a.mouse.move(figStart.x, figStart.y);
      await a.mouse.down();
      const figEnd = screenAt(center, 120, 0);
      await a.mouse.move(figEnd.x, figEnd.y, { steps: 6 });
      // The green stand stands over the figure (the new home is B).
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release moves the member from A to B (over the wire to pane B).
      await expect.poll(async () => (await groupMembers(b, "b", bGroup)).includes(member), SETTLE).toBe(true);
      await expect.poll(async () => (await groupMembers(b, "b", aGroup)).includes(member), SETTLE).toBe(false);
      void aGroup;
    } finally {
      await close();
    }
  });
});
