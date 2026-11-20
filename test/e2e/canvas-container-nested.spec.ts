// The canvas container (the reworked group)'s nested membership: the
// nested drag-in (the inner joins the outer, the unit's members ride),
// the nested drag-out (the inner leaves its parent), and the nested
// move (the outer's drag moves the inner container and its member).
import { expect, test } from "@playwright/test";

import { docBlocks, groupMembers, zoomOut } from "./canvas-container-scene";
import { SETTLE, canvasCenter, screenAtZoom, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the nested membership", () => {
  test("the nested drag-in: the container fully inside another joins it (the unit's members ride)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-nested-in");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed the outer (B) at the center and the inner (A, with its own
      // member) fully outside B (to the right).
      const { inner, outer, innerMember } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId =
          Object.entries(json.blocks).find(([, block]) => (block as { type: string }).type === "surface")?.[0] ??
          doc.insertBlock("surface");
        const outer = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(outer, { x: 0, y: 0, w: 300, h: 240 });
        const inner = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(inner, { x: 250, y: 0, w: 160, h: 100 });
        const innerMember = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
        doc.setGeometry(innerMember, { x: 250, y: 0, w: 60, h: 40 });
        doc.transact(() => doc.updateBlock(inner, { members: [innerMember] }));
        return { inner, outer, innerMember };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[inner] !== undefined, SETTLE).toBe(true);
      // Seed: the inner stands outside the outer (not a member), its member
      // stands in the inner.
      expect(await groupMembers(b, "b", outer)).not.toContain(inner);
      expect(await groupMembers(b, "b", inner)).toContain(innerMember);
      // Zoom out to 50% so the scene stands inside the view's visible area.
      const zoom = await zoomOut(a, "a", 50);
      const center = await canvasCenter(a, "a");
      // Press the inner's border (the top edge) and drag it into the outer's
      // box (the inner's box fully inside the outer's).
      const borderStart = screenAtZoom(center, 250, -50, zoom);
      await a.mouse.move(borderStart.x, borderStart.y);
      await a.mouse.down();
      // The inner's center lands at the origin (the delta -250/0 canvas).
      const borderEnd = screenAtZoom(center, 0, -50, zoom);
      await a.mouse.move(borderEnd.x, borderEnd.y, { steps: 6 });
      // The green stand stands over the inner container.
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="in"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release: the inner joins the outer (over the wire), its member
      // stays a member of the inner (the unit's members ride), and the unit
      // stands the delta.
      await expect.poll(async () => (await groupMembers(b, "b", outer)).includes(inner), SETTLE).toBe(true);
      await expect.poll(async () => (await groupMembers(b, "b", inner)).includes(innerMember), SETTLE).toBe(true);
      const blocksA = await docBlocks(a, "a");
      expect(blocksA[inner]?.geometry).toEqual({ x: 0, y: 0, w: 160, h: 100 });
      expect(blocksA[innerMember]?.geometry).toEqual({ x: 0, y: 0, w: 60, h: 40 });
      // No self-reference: the inner's box stands inside itself, but the
      // inner is not a member of itself.
      expect(blocksA[inner]?.attrs?.members).not.toContain(inner);
    } finally {
      await close();
    }
  });

  test("the nested drag-out: the member-container dragged outside its parent leaves it", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "container-nested-out");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed the outer (B) at the center, the inner (A) fully inside B (a
      // member), and A's member.
      const { inner, outer, innerMember } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId =
          Object.entries(json.blocks).find(([, block]) => (block as { type: string }).type === "surface")?.[0] ??
          doc.insertBlock("surface");
        const outer = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(outer, { x: 0, y: 0, w: 300, h: 240 });
        const inner = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(inner, { x: 0, y: 0, w: 160, h: 100 });
        const innerMember = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
        doc.setGeometry(innerMember, { x: 0, y: 0, w: 60, h: 40 });
        doc.transact(() => {
          doc.updateBlock(inner, { members: [innerMember] });
          doc.updateBlock(outer, { members: [inner] });
        });
        return { inner, outer, innerMember };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[inner] !== undefined, SETTLE).toBe(true);
      // Seed: the inner stands a member of the outer.
      expect(await groupMembers(b, "b", outer)).toContain(inner);
      const zoom = await zoomOut(a, "a", 50);
      const center = await canvasCenter(a, "a");
      // Press the inner's border (the top edge) and drag it out of the
      // outer's box (the inner's box no longer inside the outer's).
      const borderStart = screenAtZoom(center, 0, -50, zoom);
      await a.mouse.move(borderStart.x, borderStart.y);
      await a.mouse.down();
      // The inner's center lands at (250, 0) (the delta +250/0 canvas).
      const borderEnd = screenAtZoom(center, 250, -50, zoom);
      await a.mouse.move(borderEnd.x, borderEnd.y, { steps: 6 });
      // The red stand stands over the inner container (it leaves the outer).
      await expect
        .poll(async () => a.locator('[data-slot="docblocks/canvas-drop-indicator"][data-drop="out"]').count())
        .toBe(1);
      await a.mouse.up();
      // The release: the inner leaves the outer (over the wire), its member
      // stays a member of the inner.
      await expect.poll(async () => (await groupMembers(b, "b", outer)).includes(inner), SETTLE).toBe(false);
      await expect.poll(async () => (await groupMembers(b, "b", inner)).includes(innerMember), SETTLE).toBe(true);
      const blocksA = await docBlocks(a, "a");
      expect(blocksA[inner]?.geometry).toEqual({ x: 250, y: 0, w: 160, h: 100 });
    } finally {
      await close();
    }
  });

  test("the nested move: the outer's drag moves the inner container and its member (one delta, the memberships stand)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-nested-move");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Seed the outer (B) at the center, the inner (A) a member of B, and
      // A's member m.
      const { inner, outer, innerMember } = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        const json = doc.toJSON();
        const surfaceId =
          Object.entries(json.blocks).find(([, block]) => (block as { type: string }).type === "surface")?.[0] ??
          doc.insertBlock("surface");
        const outer = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(outer, { x: 0, y: 0, w: 300, h: 240 });
        const inner = doc.insertBlock("group", { members: [] }, { parent: surfaceId });
        doc.setGeometry(inner, { x: 0, y: 0, w: 160, h: 100 });
        const innerMember = doc.insertBlock("shape", { variant: "rect" }, { parent: surfaceId });
        doc.setGeometry(innerMember, { x: 0, y: 0, w: 60, h: 40 });
        doc.transact(() => {
          doc.updateBlock(inner, { members: [innerMember] });
          doc.updateBlock(outer, { members: [inner] });
        });
        return { inner, outer, innerMember };
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[inner] !== undefined, SETTLE).toBe(true);
      const before = await docBlocks(a, "a");
      const zoom = await zoomOut(a, "a", 50);
      const center = await canvasCenter(a, "a");
      // Press the OUTER's border (the top edge) and drag it — the inner
      // container and its member ride with the outer (the recursive unit).
      const borderStart = screenAtZoom(center, 0, -120, zoom);
      await a.mouse.move(borderStart.x, borderStart.y);
      await a.mouse.down();
      // The delta is +150/+50 canvas (the screen offset scaled by the zoom).
      const borderEnd = screenAtZoom(center, 150, -70, zoom);
      await a.mouse.move(borderEnd.x, borderEnd.y, { steps: 5 });
      await a.mouse.up();
      // The outer, the inner, and the member all stand the +150/+50 delta
      // (over the wire to pane B).
      for (const id of [outer, inner, innerMember]) {
        await expect
          .poll(async () => (await docBlocks(b, "b"))[id]?.geometry, SETTLE)
          .toEqual({
            x: before[id]!.geometry!.x + 150,
            y: before[id]!.geometry!.y + 50,
            w: before[id]!.geometry!.w,
            h: before[id]!.geometry!.h,
          });
      }
      // The memberships stand (the inner stays in the outer, the member in
      // the inner — the relative position is invariant).
      await expect.poll(async () => (await groupMembers(b, "b", outer)).includes(inner), SETTLE).toBe(true);
      await expect.poll(async () => (await groupMembers(b, "b", inner)).includes(innerMember), SETTLE).toBe(true);
    } finally {
      await close();
    }
  });
});
