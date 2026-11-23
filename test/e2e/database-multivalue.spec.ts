// The multi's value's stand: the multi-enum / the multi row-link's
// editor over the empty cell (the pick's array, the uncheck's stand),
// the single's pick's scalar's regression, the undo's per-toggle's
// contract.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** The statuses' system table's option row id by its label (the enum's
 * options' catalog read — the option's row IS the option). */
async function statusOptionId(page: Page, label: string): Promise<string> {
  const id = await page.evaluate(async (label) => {
    const snapshot = await window.__bridge!.snapshotTable("table-statuses-enum", {});
    const nameColumnId = snapshot.columns.find((column) => column.name === "name")?.id ?? null;
    if (nameColumnId === null) return null;
    return snapshot.page.rows.find((row) => row.cells[nameColumnId] === label)?.id ?? null;
  }, label);
  if (id === null) throw new Error(`the "${label}" option stands absent over the statuses' system table`);
  return id;
}

test("the multi-enum / the multi row-links: the empty cell stands the multi editor (the first pick's array; the two picks' stand over the pane's bridge; the single's pick stands the scalar; the undo's per toggle)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-multiselect-" + Math.random().toString(36).slice(2, 8));

    // A fresh table over the pane's own bridge: the multi-enum (the demo's
    // statuses' dict), the multi row-links (the linked's people), the
    // single-enum + the single row-link (the regression's stand).
    const { tableId, linkPeopleIds, tagsColId, ownersColId, statusColId, ownerColId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "MultiSelect" }, ctx());
      const id = table.result.id;
      const people = await bridge.createTable({ name: "LinkPeople" }, ctx());
      const peopleId = people.result.id;
      const peopleNameCol = await bridge.createColumn(
        peopleId,
        { column: { name: "Name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const peopleRows = await bridge.batchRows(
        peopleId,
        {
          ops: [
            { op: "create", row: { [peopleNameCol.result.id]: "Ann" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bob" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const tagsCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Tags",
            type: "text",
            position: 0,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: true },
          },
        },
        ctx()
      );
      const ownersCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owners",
            type: "text",
            position: 1,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: true },
          },
        },
        ctx()
      );
      const statusCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Status",
            type: "text",
            position: 2,
            nullable: true,
            reference: { kind: "enum", tableId: "table-statuses-enum", many: false },
          },
        },
        ctx()
      );
      const ownerCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Owner",
            type: "text",
            position: 3,
            nullable: true,
            reference: { kind: "row", tableId: peopleId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(id, { ops: [{ op: "create", row: {}, beforeRowId: null }] }, ctx());
      return {
        tableId: id,
        linkPeopleIds: peopleRows.result.rows.map((row) => row.id),
        tagsColId: tagsCol.result.id,
        ownersColId: ownersCol.result.id,
        statusColId: statusCol.result.id,
        ownerColId: ownerCol.result.id,
      };
    });
    // The block's id scopes the grid (the doc's seed blocks stand the
    // other grids — the `first`'s stand is out).
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    const cell = (column: string) =>
      gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${column}'][data-row='0']`);
    const chipsOf = (column: string) =>
      cell(column).locator("[data-slot='docblocks/database-ref-chip']").allTextContents();
    const todoId = await statusOptionId(a, "todo");
    const doneId = await statusOptionId(a, "done");
    const doingId = await statusOptionId(a, "doing");
    const option = (value: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${value}']`);
    const bridgeCells = () =>
      a.evaluate(async (id) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[0]?.cells ?? null;
      }, tableId);

    // ---- The multi-enum: the EMPTY cell stands the multi editor (the
    // single-pick's stand is out) — the first pick commits the ARRAY.
    await cell(tagsColId).dblclick();
    await expect(option(todoId)).toBeVisible(SETTLE);
    await expect(option(todoId)).not.toHaveAttribute("data-state", "checked");
    await option(todoId).click();
    await a.waitForTimeout(50);
    await option(doneId).click();
    await a.waitForTimeout(50);
    // The two picks' stand: the chips' train (the joined text is out) +
    // the array over the pane's bridge.
    await expect(async () => {
      expect(await chipsOf(tagsColId)).toEqual(["todo", "done"]);
    }).toPass({ timeout: 5_000 });
    const cellsA = await bridgeCells();
    expect(cellsA?.[tagsColId]).toEqual([todoId, doneId]);

    // The uncheck's stand: the chips' update + the array's stand.
    await cell(tagsColId).dblclick();
    await expect(option(doneId)).toBeVisible(SETTLE);
    await option(todoId).click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf(tagsColId)).toEqual(["done"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells())?.[tagsColId]).toEqual([doneId]);

    // ---- The undo's per toggle (the existing's contract): the two
    // toggles' stand the two entries (the uncheck's + the add's). The
    // outside press stands the popover's close (the modal layer's
    // one-click stand); the grid's hotkey stands the undo over the
    // table's focus (the cell's press stands the focus stand).
    const chipsWait = (values: string[]) =>
      expect(async () => {
        expect(await chipsOf(tagsColId)).toEqual(values);
      }).toPass({ timeout: 5_000 });
    // The cell's raw press: the popover's close (the outside press) + the
    // table's focus stand (the cell's pointerdown stands it — the hotkey's
    // reach; the popover's close stands the focus over the trigger's row,
    // so the press stands the stand back).
    const statusBox = await a.evaluate(
      ({ id, statusColumnId }) => {
        const scope = document.querySelector(`[data-block-id='${id}']`);
        const el = scope?.querySelector<HTMLElement>(
          `[data-slot='docblocks/database-cell'][data-column-id='${statusColumnId}']`
        );
        const r = el?.getBoundingClientRect();
        return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      },
      { id: blockA, statusColumnId: statusColId }
    );
    expect(statusBox).not.toBeNull();
    await a.mouse.move(statusBox!.x, statusBox!.y);
    await a.mouse.down();
    await a.mouse.up();
    await a.keyboard.press("Control+Z");
    await chipsWait(["todo", "done"]);
    await a.keyboard.press("Control+Z");
    await chipsWait(["todo"]);

    // ---- The multi row-links: the same scenario over the linked's rows
    // (the chips stand the resolved displays).
    await cell(ownersColId).dblclick();
    const ownerOption = (rowId: string) =>
      a.locator(`[data-slot='docblocks/database-ref-multi-option'][data-option-value='${rowId}']`);
    await expect(ownerOption(linkPeopleIds[0]!)).toBeVisible(SETTLE);
    await ownerOption(linkPeopleIds[0]!).click();
    await a.waitForTimeout(50);
    await ownerOption(linkPeopleIds[1]!).click();
    await a.waitForTimeout(50);
    await expect(async () => {
      expect(await chipsOf(ownersColId)).toEqual(["Ann", "Bob"]);
    }).toPass({ timeout: 5_000 });
    expect((await bridgeCells())?.[ownersColId]).toEqual([linkPeopleIds[0]!, linkPeopleIds[1]!]);

    // ---- The single's pick stands the SCALAR (the regression): the
    // single-enum's cell opens the picker (the multi's stand is out), the
    // pick commits the string (not the array). The row's option-value
    // stands the option's row id (the pk's stand = the dict's value).
    await cell(statusColId).dblclick();
    await a.waitForTimeout(150);
    const enumPickerRow = a.locator("[data-slot='docblocks/database-enum-picker-row']");
    await expect(enumPickerRow.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await a.locator(`[data-slot='docblocks/database-enum-picker-row'][data-option-value='${doingId}']`).click();
    await a.waitForTimeout(50);
    const singleEnum = (await bridgeCells())?.[statusColId];
    expect(singleEnum).toBe(doingId);

    // The single row-link's cell opens the picker (the multi's stand is
    // out), the pick commits the row id's scalar.
    await cell(ownerColId).dblclick();
    // The picker's rows stand in the portaled content (the block's scope
    // is out — the pane's locator stands the pick, like the multi's).
    const rowPick = a.locator("[data-slot='docblocks/database-row-picker-row']");
    await expect(rowPick.first()).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-ref-multi-option']").count()).toBe(0);
    await rowPick.first().click();
    await a.waitForTimeout(50);
    const singleLink = (await bridgeCells())?.[ownerColId];
    expect(singleLink).toBe(linkPeopleIds[0]!);
  } finally {
    await context.close();
  }
});
