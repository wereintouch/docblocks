// The add-column's form's stand: the reference's pick (the enum's
// options over the hidden system table, the row-link's table's pick —
// the existing + the new table's flow), the name over the create, the
// Escape's close (the no-create's stand).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/**
 * The pane's default-bridge demo table (the playground seeds it per page at
 * module load — id `table-demo` (derived from the name), name "Demo",
 * 3 rows). Polls until the async seed settles and returns the first
 * table's ref. The id stands the name's slug derivation (deterministic),
 * so the `tableId` reference resolves on every page of the context's
 * storage.
 */
async function bridgeDemoTable(page: Page): Promise<{ id: string; name: string }> {
  let result: { id: string; name: string } | null = null;
  await expect
    .poll(async () => {
      result = await page.evaluate(async () => {
        if (window.__bridge === undefined) return null;
        const tables = await window.__bridge.listTables();
        // The seed creates the enum's system table before the Demo table
        // (it stands the catalog out), so the demo is found by name, not by
        // position.
        return tables.find((table) => table.name === "Demo") ?? null;
      });
      return result;
    }, SETTLE)
    .not.toBeNull();
  return result!;
}

/** The table's schema's column ids (the bridge's read). */
async function columnIds(page: Page, tableId: string): Promise<string[]> {
  return page.evaluate(
    async (id) => (await window.__bridge!.describeTable(id)).columns.map((column) => column.id),
    tableId
  );
}

/** Poll the table's schema until it stands `count` columns and return the
 * last one's id (the form's create's stand — the new column stands
 * appended). */
async function awaitedLastColumnId(page: Page, tableId: string, count: number): Promise<string> {
  await expect.poll(async () => (await columnIds(page, tableId)).length, SETTLE).toBe(count);
  return (await columnIds(page, tableId))[count - 1]!;
}

test("the add-column form's ref stand (the enum's options editor over the hidden system table; the row-link's table pick — the existing + the new-table flows)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-refpick-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    const blockId = await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator(`[data-block-id='${blockId}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);
    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    const openForm = async (entry: string) => {
      await trigger.click();
      await expect(menu).toBeVisible(SETTLE);
      await menu.locator(`[data-column-entry='${entry}']`).click();
      await expect(form).toBeVisible(SETTLE);
    };
    const columnOf = async (id: string) =>
      a.evaluate(
        async (args) => {
          const { tableId, colId } = args as { tableId: string; colId: string };
          const schema = await window.__bridge!.describeTable(tableId);
          return schema.columns.find((column) => column.id === colId);
        },
        { tableId: demo.id, colId: id }
      );

    // Flow 1 — the enum's options' editor (the ref table's pick stands
    // none — the options' rows stand the column's own system table, the
    // hidden stand over the `listTables`).
    await openForm("enum");
    expect(await form.locator("[data-slot='docblocks/database-add-column-ref']").count()).toBe(0);
    await expect(form.locator("[data-slot='docblocks/database-enum-options']")).toBeVisible(SETTLE);
    const addOption = async (name: string) => {
      await form.locator("[data-slot='docblocks/database-enum-option-add']").click();
      const inputs = form.locator("[data-slot='docblocks/database-enum-option-name']");
      await inputs.last().fill(name);
    };
    await addOption("good");
    await addOption("bad");
    await form.locator("[data-slot='docblocks/database-add-column-name']").fill("Mood");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const moodColId = await awaitedLastColumnId(a, demo.id, 5);
    const header1 = gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${moodColId}']`);
    await expect(header1).toBeVisible(SETTLE);
    const created1 = await columnOf(moodColId);
    expect(created1).toMatchObject({ reference: { kind: "enum" } });
    const moodTableId = created1?.reference?.tableId ?? "";
    const tableNames = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames.map((name) => name.toLowerCase())).not.toContain(moodTableId.toLowerCase());
    const moodRows = await a.evaluate(async (id) => {
      const snapshot = await window.__bridge!.snapshotTable(id, {});
      const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
      if (nameColumnId === null) return null;
      return snapshot.page.rows.map((row) => row.cells[nameColumnId]);
    }, moodTableId);
    expect(moodRows).toEqual(["good", "bad"]);

    // Flow 2 — the row-link's existing table's pick (the package's Select —
    // the native select is gone; the demo's Projects table stands the
    // pick): the pick commits the column over the pane's bridge.
    await openForm("row-link");
    const refTrigger = form.locator("[data-slot='docblocks/database-add-column-ref']");
    await expect(refTrigger).toBeVisible(SETTLE);
    expect(await form.locator("select").count()).toBe(0);
    await expect(refTrigger).toContainText("— Select a table —");
    await expect(form.locator("[data-slot='docblocks/database-add-column-create']")).toBeDisabled();
    await refTrigger.click();
    const listbox = a.locator("[role='listbox']");
    await expect(listbox).toBeVisible(SETTLE);
    await listbox.locator("[role='option']", { hasText: "Projects" }).click();
    await expect(refTrigger).toHaveText("Projects", SETTLE);
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const rowLinkColId = await awaitedLastColumnId(a, demo.id, 6);
    await expect(
      gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${rowLinkColId}']`)
    ).toBeVisible(SETTLE);
    expect(await columnOf(rowLinkColId)).toMatchObject({
      reference: { kind: "row", tableId: "table-projects" },
    });

    // Flow 3 — the "New table…" pick (the row-link's): the name's input
    // stands over the form, the create commits the table + the column
    // (the pane's bridge).
    await openForm("row-link");
    const refTrigger2 = form.locator("[data-slot='docblocks/database-add-column-ref']");
    await refTrigger2.click();
    const listbox2 = a.locator("[role='listbox']");
    await expect(listbox2).toBeVisible(SETTLE);
    await listbox2.locator("[role='option']", { hasText: "New table…" }).click();
    await expect(listbox2).toBeHidden(SETTLE);
    const newName = form.locator("[data-slot='docblocks/database-add-column-ref-new']");
    await expect(newName).toBeVisible(SETTLE);
    await newName.fill("People");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    const peopleColId = await awaitedLastColumnId(a, demo.id, 7);
    await expect(
      gridA.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${peopleColId}']`)
    ).toBeVisible(SETTLE);
    expect(await columnOf(peopleColId)).toMatchObject({
      reference: { kind: "row", tableId: "table-people" },
    });
    const tableNames2 = await a.evaluate(async () => (await window.__bridge!.listTables()).map((t) => t.name));
    expect(tableNames2).toContain("People");
  } finally {
    await context.close();
  }
});

test("the add-column form stands for every type (the name over the create; the Escape closes without the create)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-addcolumnform-" + Math.random().toString(36).slice(2, 8));

    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    const gridA = a.locator("[data-slot='docblocks/database-grid']");
    await expect(gridA.first()).toBeVisible(SETTLE);

    // The Date & time entry stands the create form (the name input; the
    // number's attribute fields stand none — the type-specific block stands
    // for the number only): the name from the input + the create button
    // commit the column over the pane's bridge.
    const trigger = a.locator("[data-slot='docblocks/database-add-column-trigger']");
    await trigger.click();
    const menu = a.locator("[data-slot='dropdown-menu-content']");
    await expect(menu).toBeVisible(SETTLE);
    await menu.locator("[data-column-entry='datetime']").click();
    // The menu's exit stand the close (the exiting popper's wrapper is
    // transparent to pointers only after the unmount — the press over the
    // chip stands no swallow on the second open).
    await expect(menu).toBeHidden(SETTLE);
    const form = a.locator("[data-slot='docblocks/database-add-column-form']");
    await expect(form).toBeVisible(SETTLE);
    const nameInput = form.locator("[data-slot='docblocks/database-add-column-name']");
    expect(await nameInput.inputValue()).toBe("Date & time");
    expect(await form.locator("[data-slot='docblocks/database-add-column-decimals']").count()).toBe(0);
    await nameInput.fill("Launch");
    await form.locator("[data-slot='docblocks/database-add-column-create']").click();
    await expect(form).toBeHidden(SETTLE);
    // The demo table stands 4 columns → the created one is the fifth.
    const launchColId = await awaitedLastColumnId(a, demo.id, 5);
    const headerA = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${launchColId}']`).first();
    await expect(headerA).toHaveText("Launch", SETTLE);

    // The Escape over the form closes without the create (the column count
    // stands — the commit stands the form's button only).
    await trigger.click();
    await menu.locator("[data-column-entry='text']").click();
    await expect(menu).toBeHidden(SETTLE);
    await expect(form).toBeVisible(SETTLE);
    await a.keyboard.press("Escape");
    await expect(form).toBeHidden(SETTLE);
    expect(await columnIds(a, demo.id)).toHaveLength(5);
  } finally {
    await context.close();
  }
});
