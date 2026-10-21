import { type Browser, type Page, expect, test } from "@playwright/test";

// The canvas groups (the flat marker): the
// Ctrl/Cmd+G's group creation (one transact, the wire's one update, the
// outline in both panes), the band's drag (the members' group move: one
// setGeometry per member in one transact, the one undo step), and the
// dissolve (the Ctrl/Cmd+Shift+G and the Delete over the selected group —
// the members stand where they are). Every test zooms out to 25% (the
// empty canvas stands free around the seeded shapes).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };
const ZOOM = 0.25;

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
  await page.getByTestId(`view-${client}-canvas`).click();
}

const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

const zoomToolbar = (page: Page, client: "a" | "b") =>
  canvasView(page, client).getByRole("toolbar", { name: "Canvas zoom" });

async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function zoomTo25(page: Page, client: "a" | "b"): Promise<void> {
  const zoom = zoomToolbar(page, client);
  for (let i = 0; i < 8; i += 1) await zoom.getByLabel("Zoom out").click();
  expect(await zoom.getByLabel("Reset zoom").textContent()).toBe("25%");
}

interface Seed {
  a: string;
  b: string;
  group: string | null;
}

/** Seed two shapes (and optionally a group over them) on the pane's doc. */
async function seedScene(page: Page, client: "a" | "b", withGroup: boolean): Promise<Seed> {
  return page.evaluate(
    ({ client, withGroup }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -100, y: -50, w: 100, h: 60 });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      doc.setGeometry(b, { x: 100, y: 50, w: 80, h: 60 });
      const group = withGroup ? doc.insertBlock("group", { members: [a, b] }, { parent: surface }) : null;
      return { a, b, group: group ?? null };
    },
    { client, withGroup }
  );
}

/** The pane's doc blocks (the raw JSON). */
function blocksOf(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; attrs?: unknown; geometry?: unknown }>> {
  return page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.toJSON().blocks as Record<string, { type: string; attrs?: unknown; geometry?: unknown }>;
  }, client);
}

/** The pane's group block id (null when none stands). */
async function groupId(page: Page, client: "a" | "b"): Promise<string | null> {
  const blocks = await blocksOf(page, client);
  return Object.entries(blocks).find(([, block]) => block.type === "group")?.[0] ?? null;
}

/** A press on the group's hit band (the left edge of the derived union). */
async function pressGroupBand(page: Page, client: "a" | "b"): Promise<void> {
  const center = await canvasCenter(page, client);
  // The union of the seeded shapes: left edge at canvas x = -150 (minus
  // the 4px breath — the band stands within the 12px hit stroke).
  const x = center.x + ZOOM * -154;
  const y = center.y + ZOOM * 0;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
}

test.describe("the canvas groups (the flat marker)", () => {
  test("Ctrl+G groups the selection (the wire's one update, the outline in both panes)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-groups-create");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo25(a, "a");
      const { a: sa, b: sb } = await seedScene(a, "a", false);

      // The selection: the a's click + the b's shift-click.
      const itemA = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${sa}"]`);
      const itemB = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${sb}"]`);
      const boxA = (await itemA.boundingBox())!;
      await a.mouse.click(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
      const boxB = (await itemB.boundingBox())!;
      // The real keyboard's Shift (the Playwright's mouse modifiers do not
      // reach the pointerdown — the canvas-selection spec's pattern).
      await a.keyboard.down("Shift");
      await a.mouse.click(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
      await a.keyboard.up("Shift");

      // The group's hotkey: one transact (the group block with the members).
      await a.keyboard.press("Control+g");
      await expect.poll(async () => groupId(a, "a"), SETTLE).not.toBeNull();
      const groupA = (await groupId(a, "a"))!;
      const blocks = await blocksOf(a, "a");
      expect((blocks[groupA!] as { attrs: { members: string[] } }).attrs.members).toEqual([sa, sb]);

      // The outline stands in A (the selection's emphasis — the group
      // stands selected after the creation) and reaches B over the wire.
      const outline = a.locator(
        `[data-testid="doc-a"] [data-slot="docblocks/canvas-group"][data-block-id="${groupA}"] [data-slot="docblocks/canvas-group-outline"]`
      );
      await expect(outline).toBeVisible();
      expect(await outline.evaluate((el) => el.hasAttribute("data-selected"))).toBe(true);
      await expect.poll(async () => groupId(b, "b"), SETTLE).toBe(groupA!);
      const outlineB = b.locator(
        `[data-testid="doc-b"] [data-slot="docblocks/canvas-group"][data-block-id="${groupA}"] [data-slot="docblocks/canvas-group-outline"]`
      );
      await expect(outlineB).toBeVisible();
    } finally {
      await close();
    }
  });

  test("the band's drag moves the group (the members' geometry over the wire, the one undo)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-groups-move");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo25(a, "a");
      const { a: sa, b: sb } = await seedScene(a, "a", true);
      await expect.poll(async () => groupId(b, "b"), SETTLE).not.toBeNull(); // the wire's settle

      // The band's drag: +40/+20 screen px = +160/+80 canvas px at 25%.
      const center = await canvasCenter(a, "a");
      const startX = center.x + ZOOM * -154;
      const startY = center.y;
      await a.mouse.move(startX, startY);
      await a.mouse.down();
      await a.mouse.move(startX + 40, startY + 20, { steps: 8 });
      await a.mouse.up();

      // Both members stand the delta in A and B (one transact, one wire
      // update — the group block itself stands untouched).
      await expect
        .poll(async () => {
          const blocks = await blocksOf(a, "a");
          const ga = (blocks[sa] as { geometry: { x: number; y: number } }).geometry;
          const gb = (blocks[sb] as { geometry: { x: number; y: number } }).geometry;
          return ga.x === -100 + 160 && ga.y === -50 + 80 && gb.x === 100 + 160 && gb.y === 50 + 80;
        }, SETTLE)
        .toBe(true);
      await expect
        .poll(async () => {
          const blocks = await blocksOf(b, "b");
          const ga = (blocks[sa] as { geometry: { x: number; y: number } }).geometry;
          const gb = (blocks[sb] as { geometry: { x: number; y: number } }).geometry;
          return ga.x === 60 && ga.y === 30 && gb.x === 260 && gb.y === 130;
        }, SETTLE)
        .toBe(true);
      const groupA = (await blocksOf(a, "a"))[String(await groupId(a, "a"))];
      expect(groupA).not.toHaveProperty("geometry");

      // The one undo step: the whole group move reverts (both members).
      await a.keyboard.press("Control+z");
      await expect
        .poll(async () => {
          const blocks = await blocksOf(a, "a");
          const ga = (blocks[sa] as { geometry: { x: number; y: number } }).geometry;
          const gb = (blocks[sb] as { geometry: { x: number; y: number } }).geometry;
          return ga.x === -100 && ga.y === -50 && gb.x === 100 && gb.y === 50;
        }, SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });

  test("the dissolve: Ctrl+Shift+G and the Delete (the members stand where they are)", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "canvas-groups-dissolve");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      await zoomTo25(a, "a");
      const { a: sa, b: sb } = await seedScene(a, "a", true);
      await expect.poll(async () => groupId(b, "b"), SETTLE).not.toBeNull(); // the wire's settle

      // The ungroup hotkey: the band's press (the group stands selected)
      // + Ctrl/Cmd+Shift+G (the group goes, the members stand).
      await pressGroupBand(a, "a");
      await a.keyboard.press("Control+Shift+g");
      await expect.poll(async () => groupId(a, "a"), SETTLE).toBeNull();
      await expect.poll(async () => groupId(b, "b"), SETTLE).toBeNull();
      const blocksAfterUngroup = await blocksOf(a, "a");
      expect(blocksAfterUngroup[sa]).toBeDefined();
      expect(blocksAfterUngroup[sb]).toBeDefined();

      // The Delete's dissolve: the new group (the hotkey's creation) over
      // the band's press + the Delete key (the dissolve, no cascade).
      const itemA = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${sa}"]`);
      const itemB = a.locator(`[data-testid="doc-a"] [data-slot="docblocks/canvas-item"][data-block-id="${sb}"]`);
      const boxA = (await itemA.boundingBox())!;
      await a.mouse.click(boxA.x + boxA.width / 2, boxA.y + boxA.height / 2);
      const boxB = (await itemB.boundingBox())!;
      // The real keyboard's Shift (the Playwright's mouse modifiers do not
      // reach the pointerdown — the canvas-selection spec's pattern).
      await a.keyboard.down("Shift");
      await a.mouse.click(boxB.x + boxB.width / 2, boxB.y + boxB.height / 2);
      await a.keyboard.up("Shift");
      await a.keyboard.press("Control+g");
      const group = await expect.poll(async () => groupId(a, "a"), SETTLE).not.toBeNull();
      // The band's press stands the group's selection; the Delete
      // dissolves (the pure-canvas delete path — the group is a surface
      // child, the members are not cascaded).
      await pressGroupBand(a, "a");
      await a.keyboard.press("Delete");
      await expect.poll(async () => groupId(a, "a"), SETTLE).toBeNull();
      await expect.poll(async () => groupId(b, "b"), SETTLE).toBeNull();
      const blocksAfterDelete = await blocksOf(a, "a");
      expect(blocksAfterDelete[sa]).toBeDefined();
      expect(blocksAfterDelete[sb]).toBeDefined();
      void group;
    } finally {
      await close();
    }
  });
});
