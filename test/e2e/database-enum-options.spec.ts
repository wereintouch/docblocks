// The enum's options' block's stand: the standard's font, the shared
// color's palette, the grip's live reorder.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** The pane's bridge's demo table (the seed's stand). */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        return tables.find((table) => table.name === "Demo") ?? null;
      });
      return result;
    }, SETTLE)
    .not.toBeNull();
  return result!;
}

test("the options' block stands the standard's font, the shared color's palette and the grip's live reorder", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `enum-form-${Math.random().toString(36).slice(2, 8)}`);
    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const grid = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(grid).toBeVisible(SETTLE);

    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await trigger.click();
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-column-entry='enum']").click();
    await expect(form).toBeVisible(SETTLE);

    // The form's width's stand (the w-72's 288 px — the popover's box's
    // stand over the form's inner's content). The enter animation's zoom
    // scales the box during the settle window, so the box's measure waits
    // for the transform to settle.
    const formPopover = a.locator("[data-slot='popover-content']").last();
    await expect(formPopover).toHaveCSS("transform", "none");
    const formBox = await formPopover.boundingBox();
    expect(formBox!.width).toBeCloseTo(288, 0);

    // The standard's font (the text-sm's 14 px over the form's entries).
    const fontOf = (slot: string) =>
      form
        .locator(`[data-slot='${slot}']`)
        .first()
        .evaluate((el) => getComputedStyle(el).fontSize);
    await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
    expect(await fontOf("docblocks/database-enum-option-name")).toBe("14px");
    expect(await fontOf("docblocks/database-enum-option-add")).toBe("14px");

    // The shared color's palette (the format's / the shape's toolbars'
    // stand): the 7's swatches + the none's stand.
    const addOption = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption("alpha");
    await addOption("beta");
    await addOption("gamma");
    const colorTrigger = form.locator("[data-slot='docblocks/database-enum-option-color']").first();
    await colorTrigger.click();
    const swatches = a.locator("[data-slot='docblocks/palette-swatch']");
    const noneSwatch = a.locator("[data-slot='docblocks/palette-none']");
    await expect(swatches).toHaveCount(7, SETTLE);
    await expect(noneSwatch).toHaveCount(1, SETTLE);
    const secondHex = (await swatches.nth(1).getAttribute("data-color"))!;
    await swatches.nth(1).click();
    await expect(colorTrigger).toHaveAttribute("data-color", secondHex, SETTLE);
    await a.waitForTimeout(200); // the palette's popover stands the close on the pick (no Escape — it stands the form's close over the pick's draft)

    // The grip's live reorder (the framer's Reorder's stand over the
    // motion's editor — the playground's default): the first's option's
    // row's drag over the third's seat stands the live's offset (the row's
    // travel over the drag).
    const grips = form.locator("[data-slot='docblocks/database-enum-option-grip']");
    const rows = form.locator("[data-slot='docblocks/database-enum-option-row']");
    await expect(rows).toHaveCount(4, SETTLE); // the empty's first + alpha + beta + gamma
    const gripBox = await grips.nth(1).boundingBox(); // alpha's row's grip
    await a.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2);
    await a.mouse.down();
    // The two rows' travel (the ~36 px pitch) over the gamma's seat.
    // The webkit stand: the travel steps over the pitch boundaries with
    // a settle at each — the one-shot move outruns the layout's tracking
    // under load, and the reorder's swap is read from the tracked
    // position, not the pointer's.
    await a.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2 + 36, { steps: 6 });
    await a.waitForTimeout(150);
    await a.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2 + 72, { steps: 6 });
    await a.waitForTimeout(150);
    await a.mouse.up();
    await a.waitForTimeout(400); // the back-out's settle
    const orderAfter = await rows.evaluateAll((els) =>
      els.map((el) => (el.querySelector("input") as HTMLInputElement).value)
    );
    expect(orderAfter).toEqual(["", "beta", "gamma", "alpha"]);

    // The commit's stand (the regression): the system's table's rows stand
    // the dragged's order.
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Mood");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const moodOrder = await a.evaluate(async (tableId) => {
      const bridge = window.__bridge!;
      const schema = await bridge.describeTable(tableId);
      const column = schema.columns.find((entry) => entry.name === "Mood");
      const refTableId = column?.reference?.tableId;
      if (refTableId === undefined) return null;
      const snapshot = await bridge.snapshotTable(refTableId, {});
      const nameColumnId = snapshot.columns.find((entry) => entry.name === "name")?.id ?? null;
      if (nameColumnId === null) return null;
      return snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    }, demo.id);
    expect(moodOrder).toEqual(["beta", "gamma", "alpha"]);
  } finally {
    await context.close();
  }
});
