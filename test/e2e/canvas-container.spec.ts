import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The canvas container (the reworked group):
// the dock's container tool (the click's default-size place, the drag-to-size),
// the container's own free box (the positioned render + the eight resize
// handles), the title's inline edit + the set-title menu, the drag-in /
// drag-out's membership (the green / red stand, the release's one transact
// over the wire), the container's move (the box + the members), the border's
// selection (the figures stand z-above), and the delete (the members stand).
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

const dock = (page: Page, client: "a" | "b") => canvasView(page, client).getByRole("toolbar", { name: "Canvas tools" });

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A canvas point at 100% zoom / no pan stands at the center + the offset. */
function screenAt(center: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return { x: center.x + x, y: center.y + y };
}

/** A canvas point at an arbitrary zoom / no pan stands at the center + the scaled offset. */
function screenAtZoom(center: { x: number; y: number }, x: number, y: number, zoom: number): { x: number; y: number } {
  return { x: center.x + x * zoom, y: center.y + y * zoom };
}

/** Steps the zoom down (10% per step) to the target percent; returns the factor. */
async function zoomOut(page: Page, client: "a" | "b", targetPercent: number): Promise<number> {
  const toolbar = page.getByRole("toolbar", { name: "Canvas zoom" });
  let label = (await toolbar.getByLabel("Reset zoom").textContent()) ?? "100%";
  let current = parseInt(label, 10);
  while (current > targetPercent) {
    await toolbar.getByLabel("Zoom out").click();
    label = (await toolbar.getByLabel("Reset zoom").textContent()) ?? label;
    current = parseInt(label, 10);
  }
  return parseInt(label ?? `${targetPercent}%`, 10) / 100;
}

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
}

async function docBlocks(page: Page, client: "a" | "b"): Promise<Record<string, CanvasBlock>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<string, CanvasBlock> = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        out[id] = block as CanvasBlock;
      }
      return out;
    },
    { client }
  );
}

async function seedScene(page: Page, client: "a" | "b"): Promise<{ group: string; inside: string; outside: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      // The container (a group with its own free box) at the right of the
      // origin, a member fully inside, and a figure outside (the drag-in's
      // source).
      const group = doc.insertBlock("group", { members: [] }, { parent: surface });
      doc.setGeometry(group, { x: 120, y: 0, w: 240, h: 160 });
      const inside = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(inside, { x: 100, y: 0, w: 80, h: 60 });
      const outside = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(outside, { x: -160, y: 0, w: 80, h: 60 });
      doc.transact(() => {
        doc.updateBlock(group, { members: [inside] });
      });
      return { group, inside, outside };
    },
    { client }
  );
}

/** The group's members from the doc. */
async function groupMembers(page: Page, client: "a" | "b", group: string): Promise<string[]> {
  const blocks = await docBlocks(page, client);
  return (blocks[group]?.attrs?.members as string[]) ?? [];
}

test.describe("the canvas container (the reworked group)", () => {
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
