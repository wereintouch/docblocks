// The column's rename's contract over the browser: the open's focus + the
// select-all (a keystroke replaces the name), the menu's typeahead's
// isolation (a typed letter over a menu item's initial retargets no focus),
// the Enter's commit's no-revert (the field stands the typed name, not the
// stale one), the live name's reseed over an open edit (a bridge's rename
// while the menu stands), and the blur's commit over the menu item's press
// (the rename's write + the item's action both stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** The pane's default-bridge demo table (the playground seeds it per page
 * at module load — id `table-demo`, name "Demo"). */
async function bridgeDemoTable(page: Page): Promise<string> {
  let result: string | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        return tables.find((table) => table.name === "Demo")?.id ?? null;
      });
      return result;
    }, SETTLE)
    .not.toBeNull();
  return result!;
}

/** The demo table's first column's id (the bridge's schema read). */
async function firstColumnId(page: Page, tableId: string): Promise<string> {
  return page.evaluate(async (id) => (await window.__bridge!.describeTable(id)).columns[0]!.id, tableId);
}

/** The demo table's first column's name (the bridge's schema read). */
async function firstColumnName(page: Page, tableId: string): Promise<string> {
  return page.evaluate(async (id) => (await window.__bridge!.describeTable(id)).columns[0]!.name, tableId);
}

async function openFirstColumnMenu(page: Page): Promise<void> {
  // The Ellipsis stands the cell's right edge (the name's zone's press
  // stands nothing — the menu-open's only trigger).
  const ellipsis = await page.evaluate(() => {
    const btn = document.querySelector(
      '[data-slot="docblocks/database-header-cell"] [data-slot="docblocks/database-column-menu"]'
    );
    const r = btn!.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(ellipsis.x, ellipsis.y);
  await page
    .locator("[data-slot='docblocks/database-rename-input']")
    .waitFor({ state: "visible", timeout: SETTLE.timeout });
}

test("the open's focus + the select-all; the typeahead's isolation; the Enter's no-revert", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-rename-sync-" + Math.random().toString(36).slice(2, 8));
    const demoId = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demoId);
    const header = a.locator("[data-slot='docblocks/database-header-cell']").first();
    await expect(header).toContainText("Title", SETTLE);

    const rename = a.locator("[data-slot='docblocks/database-rename-input']");
    await openFirstColumnMenu(a);

    // The field stands focused over the open (no click's re-seat) with the
    // name's whole selection (a first keystroke replaces it).
    const focused = await a.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[data-slot="docblocks/database-rename-input"]');
      return {
        active: document.activeElement === input,
        start: input?.selectionStart,
        end: input?.selectionEnd,
        value: input?.value,
      };
    });
    expect(focused.active).toBe(true);
    expect(focused.start).toBe(0);
    expect(focused.end).toBe(focused.value!.length);

    // The typeahead's isolation: a typed letter over the "Delete column"'s
    // initial retargets no focus (the form's whole stand, not the item's
    // pick).
    await a.keyboard.type("Delete Me");
    const midType = await a.evaluate(() => ({
      active: document.activeElement?.getAttribute("data-slot"),
      value: document.querySelector<HTMLInputElement>('[data-slot="docblocks/database-rename-input"]')?.value,
    }));
    expect(midType.active).toBe("docblocks/database-rename-input");
    expect(midType.value).toBe("Delete Me");

    // The Enter's commit: the bridge's name stands, the header resyncs, and
    // the field stands the typed name (the stale reseed's removal — no
    // revert over the old's one).
    await a.keyboard.press("Enter");
    await expect.poll(async () => firstColumnName(a, demoId), SETTLE).toBe("Delete Me");
    await expect(header).toContainText("Delete Me", SETTLE);
    await expect(rename).toHaveValue("Delete Me");

    await a.keyboard.press("Escape");
    await expect(rename).toHaveCount(0, SETTLE);
  } finally {
    await context.close();
  }
});

test("the live name's reseed over an open edit (the pristine's follow, the typed's keep)", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-rename-reseed-" + Math.random().toString(36).slice(2, 8));
    const demoId = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demoId);
    const rename = a.locator("[data-slot='docblocks/database-rename-input']");

    // The pristine's follow: the bridge's rename over the open menu stands
    // the field's value (the live name's stand).
    await openFirstColumnMenu(a);
    await expect(rename).toHaveValue("Title");
    await a.evaluate(async (id) => {
      const columnId = (await window.__bridge!.describeTable(id)).columns[0]!.id;
      await window.__bridge!.updateColumn(
        id,
        columnId,
        { name: "Peer Renamed" },
        {
          operationId: crypto.randomUUID(),
          issuedAt: new Date().toISOString(),
        }
      );
    }, demoId);
    await expect.poll(async () => await rename.inputValue().catch(() => null), SETTLE).toBe("Peer Renamed");

    // The typed's keep: the draft stands over the next settle (the input's
    // text's no-clobber over the commit's reseat).
    await rename.fill("My Draft");
    await a.keyboard.press("Escape");
    await expect(rename).toHaveCount(0, SETTLE);
    expect(await firstColumnName(a, demoId)).toBe("Peer Renamed");
  } finally {
    await context.close();
  }
});

test("the blur's commit over the menu item's press (the rename's write + the item's action)", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-rename-blur-" + Math.random().toString(36).slice(2, 8));
    const demoId = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demoId);
    const header = a.locator("[data-slot='docblocks/database-header-cell']").first();
    await expect(header).toContainText("Title", SETTLE);
    const columnId = await firstColumnId(a, demoId);

    await openFirstColumnMenu(a);
    const rename = a.locator("[data-slot='docblocks/database-rename-input']");
    await rename.fill("Renamed And Hidden");
    // The item's press: the blur's commit stands the rename's write, and
    // the item's action stands the hide (the column's visibility's toggle).
    await a.getByRole("menuitem", { name: "Hide column" }).click();
    await expect.poll(async () => firstColumnName(a, demoId), SETTLE).toBe("Renamed And Hidden");
    // The column stands hidden (the visible header's count over the rows'
    // columns).
    const visible = await a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id]`).count();
    const schema = await a.evaluate(async (id) => (await window.__bridge!.describeTable(id)).columns.length, demoId);
    expect(visible).toBe(schema - 1);
    expect(
      await a.evaluate(
        async ({ columnId }) => {
          const block = Object.values(window.__paneDocs!.a!.toJSON().blocks).find((b) => b.type === "database") as {
            attrs?: { hiddenColumns?: string[] };
          };
          return block?.attrs?.hiddenColumns?.includes(columnId) ?? false;
        },
        { columnId }
      )
    ).toBe(true);

    await a.keyboard.press("Escape");
    await expect(rename).toHaveCount(0, SETTLE);
  } finally {
    await context.close();
  }
});
