// The header's menu's open's stand: the Ellipsis's own press is the
// only trigger (the name's press stands nothing), the drag's reorder
// over the wire, the cursor's grab.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, expectStays, openPane } from "./helpers";

/**
 * Two panes in ONE browser context (the same origin): the persistent
 * bridges share the localStorage snapshot, so both panes' bridges stand
 * the same seeded tables over the deterministic ids. The existing
 * `twoPanes` helper uses separate contexts (isolated origins). A pane's
 * grid reads its own bridge only — the cross-bridge live event stand is
 * none, so a spec's cross-pane bridge assertions stand the pane's own
 * bridge only.
 */
async function twoPanesSharedContext(
  browser: Browser,
  room: string
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const context = await editorContext(browser);
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  const a = await context.newPage();
  const b = await context.newPage();
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await context.close();
    },
  };
}

test("the header's menu opens only over the Ellipsis (the name's press stands nothing; the drag reorders; the cursor stands grab)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-header-menu");
  try {
    const { tableId, blockA, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "HeaderMenu" }, ctx());
      const id = table.result.id;
      const names = ["Alpha", "Beta", "Gamma"];
      const colIds: string[] = [];
      for (let index = 0; index < names.length; index++) {
        const receipt = await bridge.createColumn(
          id,
          { column: { name: names[index]!, type: "text", position: index, nullable: true } },
          ctx()
        );
        colIds.push(receipt.result.id);
      }
      const blockA = window.__paneDocs!.a!.insertBlock("database", { tableId: id });
      return { tableId: id, blockA, colIds };
    });
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);

    const headerA = a.locator(
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}']`
    );
    await expect(headerA).toBeVisible(SETTLE);

    // The cursor stands grab over the header (the drag's affordance — the
    // hand; the active's grabing over the press's stand).
    expect(await headerA.evaluate((el) => getComputedStyle(el).cursor)).toBe("grab");

    // A click on the name's zone (the header's left part — the Ellipsis
    // stands right) stands nothing: the column menu's popover stands absent
    // (the Ellipsis's own press is the only menu-open's trigger).
    const nameSpan = headerA.locator(":scope > span").first();
    const nameBox = (await nameSpan.boundingBox())!;
    await a.mouse.click(nameBox.x + nameBox.width / 2, nameBox.y + nameBox.height / 2);
    // The menu's rename input (the column menu's content) stands absent —
    // held over the window (a late menu-open lands after a single sample).
    await expectStays(async () => {
      expect(await a.locator("[data-slot='docblocks/database-rename-input']").count()).toBe(0);
    });

    // The Ellipsis's press stands the menu (the rename's input + the items
    // — the existing's content's regression: the type's line stands).
    await a
      .locator(
        `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}'] [data-slot='docblocks/database-column-menu']`
      )
      .click();
    const rename = a.locator("[data-slot='docblocks/database-rename-input']");
    await expect(rename).toBeVisible(SETTLE);
    await expect(a.locator("[data-slot='docblocks/database-column-type']")).toHaveText("text", SETTLE);
    await a.keyboard.press("Escape");
    await expect(rename).toHaveCount(0, SETTLE);

    const headerOrder = (pane: Page) =>
      pane
        .locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell']`)
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute("data-column-id")));
    // Before the drag: the first column stands first (the creation's order).
    expect((await headerOrder(a))[0]).toBe(colIds[0]);

    // The drag's reorder stands from the header's name's zone (the past-
    // threshold's press: the columnOrder's commit, both panes' resync). The
    // name's stand is the same zone (the click's point) — the drag is a
    // past-threshold press, not the click's no-op. The target stands past
    // the last column's live midpoint (the parting's shift) — the first
    // column lands at the sequence's end.
    const dragBox = (await headerA.boundingBox())!;
    const lastColBox = (await a
      .locator(
        `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[2]}']`
      )
      .boundingBox())!;
    await a.mouse.move(dragBox.x + 12, dragBox.y + dragBox.height / 2);
    await a.mouse.down();
    await a.mouse.move(lastColBox.x + lastColBox.width + 50, dragBox.y + dragBox.height / 2, { steps: 12 });
    // The in-flight drag's preview (the gesture must stay held over the
    // sample — the wall-clock's stand, not state-based).
    await a.waitForTimeout(250);
    await a.mouse.up();

    // After the drag: the first column stands no longer first (the
    // reorder's commit).
    await expect.poll(async () => (await headerOrder(a))[0], SETTLE).not.toBe(colIds[0]);
    // Pane B's grid resyncs from the columnOrder's attr (the wire's commit).
    await expect.poll(async () => (await headerOrder(b))[0], SETTLE).not.toBe(colIds[0]);
  } finally {
    await close();
  }
});
