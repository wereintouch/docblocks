// The filter's builder's stand: the single-line's condition (the
// connector's line, the group's card, the width's floor), and the
// filtered-out's inserted row's pending outline (the theme's stand, the
// focus's leave's dismissal).
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

test("the filter menu: the single-line's condition, the connector's line, the group's card (the width's stand)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", `db-filter-menu-${Math.random().toString(36).slice(2, 8)}`, { light: true });
    const demo = await bridgeDemoTable(a);
    await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
    await a.locator("[data-slot='docblocks/database-grid']").first().waitFor({ timeout: 30_000 });
    await a.locator("[data-slot='docblocks/database-filter']").click();
    const popover = a.locator("[data-slot='popover-content']", {
      has: a.locator("[data-slot='docblocks/filter-builder']"),
    });
    await expect(popover).toBeVisible(SETTLE);

    // The parent's container's stand (the widened stand): the popover stands
    // the `min-w`'s floor (the `w-96`'s former's stand is gone) — wide
    // enough for the condition's field + operator + value's single row.
    // The computed width (not the bounding box — the open's zoom's animation
    // scales the box under the measurement).
    const width = await popover.evaluate((el) => parseFloat(getComputedStyle(el).width));
    expect(width).toBeGreaterThanOrEqual(440);

    // The condition's row: the field's select and the value's input stand on
    // the same center line (no wrap — the value fills the row's leftover).
    await a.locator("[data-slot='docblocks/filter-add-condition']").first().click();
    const row = a.locator("[data-slot='docblocks/filter-condition']").first();
    const centers = await row
      .locator("[data-slot='docblocks/filter-column'], [data-slot='docblocks/filter-value']")
      .evaluateAll((els) =>
        els.map((el) => {
          const rect = el.getBoundingClientRect();
          return rect.top + rect.height / 2;
        })
      );
    expect(centers.length).toBe(2);
    expect(Math.abs(centers[0]! - centers[1]!)).toBeLessThan(1);

    // The connector's line: the row's gutter tick stands a visible (not
    // transparent) frame over the popover's background.
    const tickBg = await row
      .locator("span[aria-hidden]")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(tickBg).not.toBe("rgba(0, 0, 0, 0)");

    // The logic's pill stands the prominent's fill (not the track's muted's
    // stand — the pill reads as the selection's highlight).
    const pillBg = await popover
      .locator("[data-slot='docblocks/filter-logic-pill']")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    const trackBg = await popover
      .locator("[data-slot='docblocks/filter-logic']")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(pillBg).not.toBe(trackBg);

    // The active logic button's hover keeps the label's color (the ghost's
    // hover restyle must not wash the label over the pill's fill — the
    // dark's label stand stays readable over the prominent's fill).
    const activeLogic = popover.locator("[data-filter-logic='and']");
    const labelColorBefore = await activeLogic.evaluate((el) => getComputedStyle(el).color);
    await activeLogic.hover();
    expect(await activeLogic.evaluate((el) => getComputedStyle(el).color)).toBe(labelColorBefore);

    // The footer's apply/clear stand over the separator's line (not stuck to
    // the add rows).
    const footerBorder = await popover
      .locator("[data-slot='docblocks/filter-footer']")
      .evaluate((el) => getComputedStyle(el).borderTopWidth);
    expect(footerBorder).toBe("1px");

    // The add row's stand over the footer: a clear break (the popover's
    // gap + the separator's line + the footer's own padding), not a stuck
    // touch.
    const footerGap = await popover.evaluate((pop) => {
      const add = pop.querySelector<HTMLElement>("[data-slot='docblocks/filter-add-condition']");
      const clear = pop.querySelector<HTMLElement>("[data-slot='docblocks/filter-clear']");
      return clear!.getBoundingClientRect().top - add!.getBoundingClientRect().bottom;
    });
    expect(footerGap).toBeGreaterThanOrEqual(16);

    // The nested's group stands the numbered's header + the remove's entry +
    // its own logic's selector over the card.
    await a.locator("[data-slot='docblocks/filter-add-group']").first().click();
    const card = a.locator("[data-slot='docblocks/filter-nested']").first();
    await expect(card.locator("[data-slot='docblocks/filter-group-header']")).toHaveText("Group 1", SETTLE);
    await expect(card.locator("[data-slot='docblocks/filter-remove-group']")).toBeVisible(SETTLE);
    await expect(card.locator("[data-slot='docblocks/filter-logic']")).toBeVisible(SETTLE);

    // The footer's apply stands disabled over the missing's value (the
    // draft's no-commit's stand).
    await expect(a.locator("[data-slot='docblocks/filter-apply']")).toBeDisabled(SETTLE);
    await a.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});

test("a filtered-out inserted row keeps the orange outline until focus leaves", async ({ browser }) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-filtered-insert", { light: true });
    const { tableId, titleId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "Filtered insert" }, ctx());
      const tableId = table.result.id;
      const title = await bridge.createColumn(
        tableId,
        { column: { name: "Title", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const titleId = title.result.id;
      await bridge.batchRows(
        tableId,
        { ops: [{ op: "create", row: { [titleId]: "shown" }, beforeRowId: null }] },
        ctx()
      );
      window.__paneDocs!.a!.insertBlock("database", {
        tableId,
        filter: { logic: "and", conditions: [{ columnId: titleId, op: "is", value: "shown" }] },
      });
      return { tableId, titleId };
    });
    await expect(a.locator("[data-slot='docblocks/database-grid']")).toHaveCount(1, SETTLE);

    await a.locator("[data-slot='docblocks/database-add-row']").click();
    const pending = a.locator("[data-slot='docblocks/database-cell'][data-filter-pending='true']");
    await expect(pending).toHaveCount(1, SETTLE);
    const light = await pending.evaluate((el) => ({
      token: getComputedStyle(el).getPropertyValue("--docblocks-database-pending-row-border-color").trim(),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(light.token).toBe("#d97706");
    expect(light.shadow).not.toBe("none");
    await a.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await pending.evaluate((el) => ({
      token: getComputedStyle(el).getPropertyValue("--docblocks-database-pending-row-border-color").trim(),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(dark.token).toBe("#f59e0b");
    expect(dark.shadow).not.toBe(light.shadow);
    await a.evaluate(() => document.documentElement.classList.remove("dark"));

    const editor = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(editor).toBeFocused(SETTLE);
    await editor.fill("outside the filter");
    await a.locator("[data-slot='docblocks/database-columns']").click();
    await expect(pending).toHaveCount(0, SETTLE);
    await expect
      .poll(
        () =>
          a.evaluate(
            async ({ tableId, titleId }) => {
              const snapshot = await window.__bridge!.snapshotTable(tableId, {});
              return snapshot.page.rows.some((row) => row.cells[titleId] === "outside the filter");
            },
            { tableId, titleId }
          ),
        SETTLE
      )
      .toBe(true);
  } finally {
    await context.close();
  }
});
