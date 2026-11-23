// The cell's display's single line's stand: the text's ellipsis, the
// multi's right fade, the number / the date's single-line regression,
// the single's chip's ellipsis.
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

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

test("the cell's display stands the single line (the text's ellipsis; the multi's right fade; the number / the date's single-line regression; the single's chip ellipsis)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanesSharedContext(browser, "db-display-stand");
  try {
    // A fresh table over the shared snapshot: the long text (the ellipsis's
    // stand), the number + the datetime (the single-line regression), the
    // multi-enum + the multi row-links (the right fade over the overflow),
    // and the single enum (the chip's ellipsis — the text's stand, not the
    // fade). The enum's dict's long labels + the row-link's long names force
    // the chips' train over the column's width (the overflow's stand).
    const { tableId, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "DisplayOpts", system: true }, ctx());
      const dictId = dict.result.id;
      const dictNameCol = await bridge.createColumn(
        dictId,
        { column: { name: "name", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const dictRows = await bridge.batchRows(
        dictId,
        {
          ops: [
            { op: "create", row: { [dictNameCol.result.id]: "Alpha very long option label" }, beforeRowId: null },
            { op: "create", row: { [dictNameCol.result.id]: "Beta very long option label" }, beforeRowId: null },
            { op: "create", row: { [dictNameCol.result.id]: "Gamma very long option label" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const optionIds = dictRows.result.rows.map((row) => row.id);
      const people = await bridge.createTable({ name: "DisplayPeople" }, ctx());
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
            { op: "create", row: { [peopleNameCol.result.id]: "Ann Longworth-Whitfield" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Bo Longworth-Whitfield" }, beforeRowId: null },
            { op: "create", row: { [peopleNameCol.result.id]: "Cy Longworth-Whitfield" }, beforeRowId: null },
          ],
        },
        ctx()
      );
      const personIds = peopleRows.result.rows.map((row) => row.id);
      const table = await bridge.createTable({ name: "DisplayCell" }, ctx());
      const id = table.result.id;
      const bodyCol = await bridge.createColumn(
        id,
        { column: { name: "Body", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const numCol = await bridge.createColumn(
        id,
        { column: { name: "Num", type: "integer", position: 1, nullable: true } },
        ctx()
      );
      const dtCol = await bridge.createColumn(
        id,
        { column: { name: "DT", type: "timestamptz", position: 2, nullable: true } },
        ctx()
      );
      const tagsCol = await bridge.createColumn(
        id,
        {
          column: {
            name: "Tags",
            type: "text",
            position: 3,
            nullable: true,
            reference: { kind: "enum", tableId: dictId, many: true },
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
            position: 4,
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
            position: 5,
            nullable: true,
            reference: { kind: "enum", tableId: dictId, many: false },
          },
        },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [bodyCol.result.id]:
                  "A very long piece of text that will not fit inside the cell's width and must stand one line with the trailing ellipsis instead of wrapping onto a new line of the row",
                [numCol.result.id]: 123456789,
                [dtCol.result.id]: "2026-10-26T09:15:00",
                [tagsCol.result.id]: optionIds,
                [ownersCol.result.id]: personIds,
                [statusCol.result.id]: optionIds[0]!,
              },
              beforeRowId: null,
            },
          ],
        },
        ctx()
      );
      return {
        tableId: id,
        colIds: {
          body: bodyCol.result.id,
          num: numCol.result.id,
          dt: dtCol.result.id,
          tags: tagsCol.result.id,
          owners: ownersCol.result.id,
          status: statusCol.result.id,
        },
        optionIds,
        personIds,
      };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    // The narrow widths force the multi's chips + the long text over the
    // cell (the fade / the ellipsis stand over the clip).
    await a.evaluate(
      (id) => window.__paneDocs!.a!.updateBlock(id, { columnWidths: [150, 80, 120, 110, 110, 110] }),
      blockA
    );
    await b.evaluate((id) => window.__paneDocs!.b!.insertBlock("database", { tableId: id }), tableId);

    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The display styles stand from one read (the grid's own DOM — no
    // locator's auto-wait / the strict-mode's stand over the grid's rows).
    const readStyles = () =>
      a.evaluate(
        ({ blockId, cols }) => {
          const grid = document.querySelector(
            `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
          ) as HTMLElement | null;
          if (grid === null) return null;
          const cellOf = (col: string) =>
            grid.querySelector(
              `[data-slot="docblocks/database-cell"][data-column-id="${col}"][data-row="0"]`
            ) as HTMLElement | null;
          const displayOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-cell-display"]') as HTMLElement | null;
          // The number / the datetime's display: the `database-cell-display`
          // span (the number) or the popover's trigger (the datetime — the
          // radix's clone stands the `popover-trigger` slot). Both carry the
          // `truncate`'s one line's stand.
          const contentOf = (col: string) =>
            cellOf(col)?.querySelector(
              '[data-slot="docblocks/database-cell-display"], [data-slot="popover-trigger"]'
            ) as HTMLElement | null;
          const chipsOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-ref-chips"]') as HTMLElement | null;
          const chipOf = (col: string) =>
            cellOf(col)?.querySelector('[data-slot="docblocks/database-ref-chip"]') as HTMLElement | null;
          const body = displayOf(cols.body);
          const tags = chipsOf(cols.tags);
          const owners = chipsOf(cols.owners);
          const status = chipsOf(cols.status);
          const num = contentOf(cols.num);
          const dt = contentOf(cols.dt);
          if (body === null || tags === null || owners === null || status === null || num === null || dt === null) {
            return null;
          }
          const cs = (el: Element) => getComputedStyle(el);
          const mask = (el: Element) =>
            cs(el).getPropertyValue("mask-image") || cs(el).getPropertyValue("-webkit-mask-image");
          return {
            bodyWhiteSpace: cs(body).whiteSpace,
            bodyTextOverflow: cs(body).textOverflow,
            bodyHeight: body.getBoundingClientRect().height,
            numWhiteSpace: cs(num).whiteSpace,
            dtWhiteSpace: cs(dt).whiteSpace,
            tagsFade: tags.getAttribute("data-fade"),
            tagsMask: mask(tags),
            tagsChipOverflow: cs(chipOf(cols.tags)!).getPropertyValue("text-overflow"),
            ownersFade: owners.getAttribute("data-fade"),
            ownersMask: mask(owners),
            statusFade: status.getAttribute("data-fade"),
            statusMask: mask(status),
            statusChipOverflow: cs(chipOf(cols.status)!).getPropertyValue("text-overflow"),
          };
        },
        { blockId: blockA, cols: colIds }
      );
    // The readiness: the grid's cells + the displays / the chips stand.
    await expect.poll(async () => (await readStyles()) !== null, SETTLE).toBe(true);
    const styles = await readStyles();

    // ---- The text's display: one line + the ellipsis (the wrap is out).
    expect(styles?.bodyWhiteSpace).toBe("nowrap");
    expect(styles?.bodyTextOverflow).toBe("ellipsis");
    expect(styles?.bodyHeight).toBeLessThan(28);

    // ---- The number / the datetime: one line (the regression — no wrap).
    expect(styles?.numWhiteSpace).toBe("nowrap");
    expect(styles?.dtWhiteSpace).toBe("nowrap");

    // ---- The multi-enum / the multi row-links: the right fade (the mask
    // over the overflow's train; the chips' clip stands none — no ellipsis).
    expect(styles?.tagsFade).toBe("true");
    expect(styles?.tagsMask).toContain("linear-gradient");
    expect(styles?.tagsChipOverflow).toBe("clip");
    expect(styles?.ownersFade).toBe("true");
    expect(styles?.ownersMask).toContain("linear-gradient");

    // ---- The single enum: the chip's ellipsis (the text's stand — the
    // fade stands none, no mask).
    expect(styles?.statusFade).toBe(null);
    expect(styles?.statusMask).toBe("none");
    expect(styles?.statusChipOverflow).toBe("ellipsis");

    // ---- Dark / light: the fade stands the same mask (theme-agnostic —
    // the chip's ink fades to the cell's own background over the theme).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await a.waitForTimeout(50);
    const lightMask = await a.evaluate(
      ({ blockId, tagsColId }) => {
        const grid = document.querySelector(
          `[data-block-id="${blockId}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        const chips = grid?.querySelector(
          `[data-slot="docblocks/database-cell"][data-column-id="${tagsColId}"][data-row="0"] [data-slot="docblocks/database-ref-chips"]`
        ) as HTMLElement | null;
        return chips !== null ? getComputedStyle(chips).getPropertyValue("mask-image") : null;
      },
      { blockId: blockA, tagsColId: colIds.tags }
    );
    expect(lightMask).toContain("linear-gradient");
    await a.evaluate(() => document.documentElement.classList.add("dark"));
  } finally {
    await close();
  }
});
