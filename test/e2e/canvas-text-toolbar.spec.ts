// The canvas-text's toolbar over the single selection (the "Text options"
// stand): the font family / color / style / size / align's applies — one
// updateBlock each over the wire — + the z-order menu's reorder's apply.
import { type Locator, type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasCenter, canvasView, screenAt, toCanvas, twoPanes } from "./helpers";

interface CanvasBlock {
  type: string;
  geometry?: { x: number; y: number; w: number; h: number };
  attrs?: Record<string, unknown>;
  content?: { text: string; marks: Record<string, unknown> }[];
  children?: string[];
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

/** Seed a canvas-text (the geometry's center anchor) with the text (the absent stand is the empty block) and return its id. */
async function seedText(
  page: Page,
  client: "a" | "b",
  text: string,
  geometry: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 200, h: 40 }
): Promise<string> {
  return page.evaluate(
    ({ client, text, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(
        ([, block]) => (block as { type: string }).type === "surface"
      )?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("canvas-text", undefined, { parent: surface });
      doc.setGeometry(id, geometry);
      if (text !== "") doc.insertText(id, 0, text);
      return id;
    },
    { client, text, geometry }
  );
}

/** Wait for pane B's doc to carry the id over the wire. */
async function wireSynced(page: Page, client: "a" | "b", id: string): Promise<void> {
  await expect.poll(async () => (await docBlocks(page, client))[id] !== undefined, SETTLE).toBe(true);
}

/** The selection's stand over the presses (the retry stands the clobber's race — the press's focus's move's spurious selectionchange's clobber): a same-point press over the standing caret re-stands the stable selection (the release's no-op's seat over the same point's stand stands no clobber). */
async function pressForSelection(page: Page, item: Locator, x: number, y: number): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(120);
    if ((await item.getAttribute("data-selected")) === "true") return;
  }
  await page.mouse.click(x, y);
  await expect(item).toHaveAttribute("data-selected", "true");
}

/** The surface's children's order (the z-order's stand over the doc). */
async function surfaceChildren(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return [];
      const json = doc.toJSON();
      const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "surface");
      if (surfaceId === undefined) return [];
      const block = json.blocks[surfaceId]!;
      return block.children ?? [];
    },
    { client }
  );
}

test.describe("the canvas-text (the reworked interaction)", () => {
  test("the toolbar: the single selection's 'Text options' stand; the font family / color / style / size / align's applies over the wire (one updateBlock each); the z-order menu's reorder's apply", async ({
    browser,
  }) => {
    // The suite's heaviest spec (the two's seeds + the wire's settle + the
    // font's loads + the applies' over the wire): the per-test budget stands
    // doubled over the 30 s's baseline — the 2 vCPU's runner's load overruns
    // the baseline even without a logic stall.
    test.setTimeout(60_000);
    const { a, b, close } = await twoPanes(browser, "text-toolbar");
    try {
      await toCanvas(a, "a");
      await toCanvas(b, "b");
      // Two canvas-texts (the z-order's reorder's stand — the two's
      // siblings' order).
      const idA = await seedText(a, "a", "toolbar note", { x: 0, y: -60, w: 200, h: 40 });
      const idB = await seedText(a, "a", "second note", { x: 0, y: 60, w: 200, h: 40 });
      await wireSynced(b, "b", idA);
      await wireSynced(b, "b", idB);
      const center = await canvasCenter(a, "a");
      // The press's selection's stand (the shape's parity — the single
      // press selects the block over the move session; the retry stands
      // the press's focus's move's spurious clobber): the toolbar's single
      // selection's stand.
      const point = screenAt(center, 0, -60);
      const itemA = canvasView(a, "a").locator(`[data-slot="docblocks/canvas-item"][data-block-id="${idA}"]`);
      await pressForSelection(a, itemA, point.x, point.y);
      // The leftover DOM selection's stand off (the press's focus's move
      // can stand a spurious caret over the settle): the selectionchange's
      // mapping's clobber stands the blocks' view over the editable's
      // caret — the clear's stand keeps the selection over the toolbar's
      // applies' focus roundtrips (the empty selection's stand: no
      // clobber).
      await a.evaluate(() => {
        window.getSelection()?.removeAllRanges();
        (document.activeElement as HTMLElement | null)?.blur?.();
      });
      // The toolbar stands (the single canvas-text selection's stand —
      // the "Text options" aria over the box).
      const toolbar = canvasView(a, "a").locator('[data-slot="docblocks/canvas-text-toolbar"]');
      await expect(toolbar).toHaveCount(1);
      await expect(toolbar).toHaveAttribute("aria-label", "Text options");

      // The font family's apply (the self-hosted set's pick — one
      // updateBlock over the wire).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-font-family"]').click();
      await a.getByRole("menuitemcheckbox", { name: "Lora", exact: true }).click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.fontFamily, SETTLE).toBe("Lora");

      // The text style's apply (the weight x the slant's pick).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-text-style"]').click();
      await a.getByRole("menuitemcheckbox", { name: "Semibold", exact: true }).click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textStyle, SETTLE).toBe("semibold");

      // The text color's apply (the section's hex's commit — the popover's
      // input over the trigger's stand).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-text"]').click();
      const hex = a.locator('[data-slot="docblocks/canvas-text-text-hex"]');
      await expect(hex).toHaveCount(1);
      await hex.fill("#112233");
      await hex.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textColor, SETTLE).toBe("#112233");

      // The font size's apply (the numeric field's commit — any 8-512's
      // stand).
      const size = toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-font-size"]');
      await size.fill("24");
      await size.press("Enter");
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.fontSize, SETTLE).toBe(24);

      // The alignment's apply (the left / center / right's buttons).
      await toolbar.locator('[data-slot="docblocks/canvas-text-toolbar-align-center"]').click();
      await expect.poll(async () => (await docBlocks(b, "b"))[idA]?.attrs?.textAlign, SETTLE).toBe("center");

      // The z-order menu's stand (the three-dot's trigger over the single
      // selection — the position's read over the surface's elements) + the
      // reorder's apply (the bring-forward's commit over the wire: the
      // block's z-order's stand moves up one over the siblings).
      const zMenu = toolbar.locator('[data-slot="docblocks/z-order-menu"]');
      await expect(zMenu).toHaveCount(1);
      await expect(zMenu).toHaveAttribute("aria-label", "Arrange text");
      const orderBefore = await surfaceChildren(b, "b");
      await zMenu.click();
      await a.getByRole("menuitem", { name: "Bring forward", exact: true }).click();
      await expect
        .poll(async () => (await surfaceChildren(b, "b")).indexOf(idA) > orderBefore.indexOf(idA), SETTLE)
        .toBe(true);
    } finally {
      await close();
    }
  });
});
