// The canvas container (the reworked group)'s title: the double-click's
// inline edit (the commit's one updateBlock over the wire, the empty
// commit stands off), the chip's standard font size over the screen
// layer (no world-scale amplification), and the chip's stand above the
// box's top frame.
import { expect, test } from "@playwright/test";

import { docBlocks, seedScene, zoomOut } from "./canvas-container-scene";
import { SETTLE, canvasCenter, screenAt, toCanvas, twoPanes } from "./helpers";

test.describe("the canvas container: the title", () => {
  test("the title's double-click edit: the commit's one updateBlock over the wire; the empty commit stands off", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-title");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      const { group } = await seedScene(a, "a");
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const center = await canvasCenter(a, "a");
      const blocks = await docBlocks(a, "a");
      const titlePoint = screenAt(
        center,
        blocks[group]!.geometry!.x - blocks[group]!.geometry!.w / 2 + 12,
        blocks[group]!.geometry!.y - blocks[group]!.geometry!.h / 2
      );
      // The title-less container: the set-title menu (the selected
      // title-less stand) — select the container first.
      const borderPoint = screenAt(
        center,
        blocks[group]!.geometry!.x,
        blocks[group]!.geometry!.y - blocks[group]!.geometry!.h / 2
      );
      await a.mouse.click(borderPoint.x, borderPoint.y);
      // The title menu's trigger stands (the selected title-less stand).
      const trigger = a.locator('[data-slot="docblocks/group-title-menu"]');
      expect(await trigger.count()).toBe(1);
      await trigger.click();
      const input = a.locator('[data-slot="docblocks/group-title-menu-input"]');
      await input.fill("team board");
      await input.press("Enter");
      // The commit stands the title over the wire (one updateBlock).
      await expect.poll(async () => (await docBlocks(b, "b"))[group]?.attrs?.title, SETTLE).toBe("team board");
      // The title chip stands over the committed title.
      const chip = a.locator("[data-slot='docblocks/group-title']");
      expect(await chip.textContent()).toBe("team board");
      // The double-click's inline edit: the select-all + the type replaces
      // the title; the empty commit stands the removed state (the chip
      // stands off).
      await chip.dblclick();
      const edit = a.locator('[data-slot="docblocks/group-title-edit"]');
      await expect(edit).toHaveCount(1);
      await edit.fill("");
      await edit.press("Escape");
      await expect.poll(async () => (await docBlocks(b, "b"))[group]?.attrs?.title, SETTLE).toBe("");
      await expect(a.locator("[data-slot='docblocks/group-title']")).toHaveCount(0);
      void titlePoint;
    } finally {
      await close();
    }
  });

  test("the title's chip stands the standard font size over the screen layer (no world-scale amplification)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-title-font");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The group's box is set so the top-left chip stands at the world's
      // (0, 0) (the canvas's center) — the chip stays centered through the
      // zoom's steps (the world-scale's read is clean).
      const group = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        let g = "";
        doc.transact(() => {
          const surface = doc.insertBlock("surface");
          g = doc.insertBlock("group", { members: [], title: "report" }, { parent: surface });
          doc.setGeometry(g, { x: 108, y: 80, w: 240, h: 160 });
        });
        return g;
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const chip = a.locator("[data-slot='docblocks/group-title']");
      await expect(chip).toHaveCount(1);
      // The chip stands the STANDARD font size (the editor's
      // --docblocks-font-size, not the former hardcoded 11px) — the screen
      // px stand at zoom 100%.
      const fontPx = await chip.evaluate((el) => getComputedStyle(el).fontSize);
      const tokenPx = await a.evaluate(
        () =>
          new Promise<string>((resolve) => {
            const probe = document.createElement("div");
            probe.style.fontSize = "var(--docblocks-font-size)";
            document.body.appendChild(probe);
            resolve(getComputedStyle(probe).fontSize);
            probe.remove();
          })
      );
      expect(fontPx, "the chip's font-size stands the editor's standard").toBe(tokenPx);
      expect(fontPx).not.toBe("11px");
      // The display and the inline-edit stand the SAME size (the parity:
      // display = edit-input).
      await chip.dblclick();
      const edit = a.locator('[data-slot="docblocks/group-title-edit"]');
      await expect(edit).toHaveCount(1);
      const editPx = await edit.evaluate((el) => getComputedStyle(el).fontSize);
      expect(editPx).toBe(fontPx);
      // The rename's commit stands (the inline-edit's contract is not
      // broken by the re-sized chip).
      await edit.fill("quarter report");
      await edit.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[group]?.attrs?.title, SETTLE).toBe("quarter report");
      // The screen stand: at zoom 200% the chip keeps its on-screen size
      // (the chip rides the seat's screen box — the world's scale does not
      // amplify it); the seat itself doubles over the zoom.
      const h100 = (await chip.boundingBox())!.height;
      const zoom = a.getByRole("toolbar", { name: "Canvas zoom" });
      for (let i = 0; i < 10; i += 1) await zoom.getByLabel("Zoom in").click();
      expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("200%");
      const h200 = (await chip.boundingBox())!.height;
      expect(h200).toBeCloseTo(h100, 1);
      expect(await chip.evaluate((el) => getComputedStyle(el).fontSize)).toBe(fontPx);
      const seat200 = await a
        .locator(`[data-slot="docblocks/canvas-title-chip"][data-block-id="${group}"]`)
        .evaluate((el) => ({ width: getComputedStyle(el).width, height: getComputedStyle(el).height }));
      expect(seat200.width).toBe("480px");
      expect(seat200.height).toBe("320px");
    } finally {
      await close();
    }
  });

  test("the title's chip stands above the box's top frame (the 16 px left, the 4 px gap off the border line — the screen stand over the zoom)", async ({
    browser,
  }) => {
    const { a, b, close } = await twoPanes(browser, "container-title-above");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // The group's box set so its top-left corner stands at the world's
      // (-12, 0) (the canvas's center): the chip's seat (the 16 px left,
      // the 4 px gap above the frame) stands at the world's (4, -4)
      // bottom edge — the screenAt's clean read.
      const group = await a.evaluate(() => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane's doc is not mounted");
        let g = "";
        doc.transact(() => {
          const surface = doc.insertBlock("surface");
          g = doc.insertBlock("group", { members: [], title: "above" }, { parent: surface });
          doc.setGeometry(g, { x: 108, y: 80, w: 240, h: 160 });
        });
        return g;
      });
      await expect.poll(async () => (await docBlocks(b, "b"))[group] !== undefined, SETTLE).toBe(true);
      const chip = a.locator("[data-slot='docblocks/group-title']");
      await expect(chip).toHaveCount(1);
      const center = await canvasCenter(a, "a");
      // The chip's box stand (the world's px — the computed read at zoom
      // 100%): the 16 px left offset + the 4 px gap the chip's bottom
      // edge stands off the border line (the chip stands ABOVE the
      // frame — the seat over the former on-the-line stand). The
      // text's padding stands off the chip's own frame (the 8 px / the
      // 2 px).
      expect(await chip.evaluate((el) => getComputedStyle(el).left)).toBe("16px");
      expect(await chip.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe("8px");
      expect(await chip.evaluate((el) => getComputedStyle(el).paddingTop)).toBe("2px");
      const box100 = (await chip.boundingBox())!;
      expect(box100.x).toBeCloseTo(center.x + 4, 1);
      expect(box100.y + box100.height).toBeCloseTo(center.y - 4, 1);
      // The inline edit stands the SAME seat (the display / the input's
      // parity) and the rename's commit stands (the contract's
      // regression).
      await chip.dblclick();
      const edit = a.locator('[data-slot="docblocks/group-title-edit"]');
      await expect(edit).toHaveCount(1);
      expect(await edit.evaluate((el) => getComputedStyle(el).left)).toBe("16px");
      const editBox = (await edit.boundingBox())!;
      expect(editBox.x).toBeCloseTo(center.x + 4, 1);
      expect(editBox.y + editBox.height).toBeCloseTo(center.y - 4, 1);
      await edit.fill("above two");
      await edit.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[group]?.attrs?.title, SETTLE).toBe("above two");
      // The screen stand over the zoom: the chip's 16 px left offset and
      // 4 px gap stand in SCREEN px (the seat's screen box is the world box
      // scaled; the chip's offsets do not scale with it) — at zoom 50% the
      // box's top-left corner stands at (−12·zoom, 0) from the center.
      const zoom = await zoomOut(a, "a", 50);
      const box50 = (await a.locator("[data-slot='docblocks/group-title']").boundingBox())!;
      expect(box50.x).toBeCloseTo(center.x - 12 * zoom + 16, 1);
      expect(box50.y + box50.height).toBeCloseTo(center.y - 4, 1);
    } finally {
      await close();
    }
  });
});
