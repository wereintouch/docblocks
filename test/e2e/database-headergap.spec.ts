// The header's name's uniform gap chain's stand over every column's
// type (the cell's edge → the icon → the name), and the Ellipsis's
// vertical center (the menu open's regression).
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

test("the header's name stands the uniform gap chain over all the column's types (the cell's edge → the icon → the name — the per-type's pins)", async ({
  browser,
}) => {
  const { a, close } = await twoPanesSharedContext(browser, "db-header-gap");
  try {
    // The main table: one column per type (the 10) — the name's length
    // stands different (the gap's parity is over the name's width, not the
    // name's).
    const { mainId, cols } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "Gap-enum", system: true }, ctx());
      const dictId = dict.result.id;
      await bridge.createColumn(dictId, { column: { name: "name", type: "text", position: 0, nullable: true } }, ctx());
      const link = await bridge.createTable({ name: "Gap-link" }, ctx());
      const linkId = link.result.id;
      await bridge.createColumn(
        linkId,
        { column: { name: "Label", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const main = await bridge.createTable({ name: "GapTable" }, ctx());
      const mainId = main.result.id;
      const spec: {
        name: string;
        type: string;
        reference?: { kind: "enum" | "row"; tableId: string; many: boolean };
      }[] = [
        { name: "Text", type: "text" },
        { name: "Int", type: "integer" },
        { name: "Decimal", type: "numeric" },
        { name: "Bool", type: "boolean" },
        { name: "Date", type: "date" },
        { name: "DateTime", type: "timestamptz" },
        { name: "Enum", type: "text", reference: { kind: "enum", tableId: dictId, many: false } },
        { name: "Multi", type: "text", reference: { kind: "enum", tableId: dictId, many: true } },
        { name: "RowLink", type: "text", reference: { kind: "row", tableId: linkId, many: false } },
        { name: "RLs", type: "text", reference: { kind: "row", tableId: linkId, many: true } },
      ];
      const cols: string[] = [];
      for (let index = 0; index < spec.length; index++) {
        const s = spec[index]!;
        const receipt = await bridge.createColumn(
          mainId,
          {
            column: {
              name: s.name,
              type: s.type,
              position: index,
              nullable: true,
              ...(s.reference !== undefined ? { reference: s.reference } : {}),
            },
          },
          ctx()
        );
        cols.push(receipt.result.id);
      }
      return { mainId, cols };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), mainId);

    // The gap chain's read (the grid's own DOM): per column, the gap the
    // icon's left edge stands off the cell's content edge (the cell's
    // border-left over the non-first stand) + the gap the name's text left
    // edge stands off the icon's right edge (the text's bbox — the name's
    // stand over the icon, not the value's edge).
    const readGaps = () =>
      a.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { cellToIcon: number; iconToText: number }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const icon = cell.querySelector<SVGElement>(":scope > svg");
          const span = cell.querySelector<HTMLElement>(":scope > span");
          if (icon === null || span === null) return null;
          const cellR = cell.getBoundingClientRect();
          const borderLeft = parseFloat(getComputedStyle(cell).borderLeftWidth) || 0;
          const iconR = icon.getBoundingClientRect();
          const range = document.createRange();
          range.selectNodeContents(span);
          const textR = range.getBoundingClientRect();
          if (textR.width === 0) return null;
          out[colId] = {
            cellToIcon: iconR.left - (cellR.left + borderLeft),
            iconToText: textR.left - iconR.right,
          };
        }
        return out;
      }, blockA);
    await expect.poll(async () => (await readGaps()) !== null, SETTLE).toBe(true);
    const gaps = (await readGaps())!;
    // Every type's chain stands the same (the cell's edge → the icon's 8
    // px, the icon's → the name's 8 px — the gap-1 + the px-1's parity; the
    // former align's stand pushed the number/boolean's names off the
    // icon's over the name's width).
    for (const col of cols) {
      expect(gaps[col]?.cellToIcon, `the ${col}'s cell → icon's gap`).toBeCloseTo(8, 1);
      expect(gaps[col]?.iconToText, `the ${col}'s icon → name's gap`).toBeCloseTo(8, 1);
    }
  } finally {
    await close();
  }
});

test("the header's Ellipsis stands the cell's vertical center (the border's half's stand; the right zone's stand; the menu's open regression)", async ({
  browser,
}) => {
  const { a, close } = await twoPanesSharedContext(browser, "db-ellipsis-center");
  try {
    const { blockA, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "EllipsisCenter" }, ctx());
      const id = table.result.id;
      const spec: [string, string][] = [
        ["Alpha", "text"],
        ["Beta", "integer"],
        ["Gamma", "boolean"],
      ];
      const colIds: string[] = [];
      for (let index = 0; index < spec.length; index++) {
        const [name, type] = spec[index]!;
        const receipt = await bridge.createColumn(
          id,
          { column: { name, type, position: index, nullable: true } },
          ctx()
        );
        colIds.push(receipt.result.id);
      }
      return {
        blockA: window.__paneDocs!.a!.insertBlock("database", { tableId: id }),
        colIds,
      };
    });
    const gridA = a.locator(`[data-block-id='${blockA}'] [data-slot='docblocks/database-grid']`);
    await expect(gridA).toBeVisible(SETTLE);

    // The vertical center's stand (the grid's own DOM's read): per column,
    // the Ellipsis's icon center vs the cell's center (the border-box — the
    // 1 px bottom border stands over the content's center's read).
    const readCenter = () =>
      a.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { deltaY: number; rightOffset: number }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']")
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const btn = cell.querySelector<HTMLElement>("[data-slot='docblocks/database-column-menu']");
          const svg = btn?.querySelector("svg") ?? null;
          if (btn === null || svg === null) return null;
          const cellR = cell.getBoundingClientRect();
          const svgR = svg.getBoundingClientRect();
          out[colId] = {
            deltaY: svgR.top + svgR.height / 2 - (cellR.top + cellR.height / 2),
            rightOffset: cellR.right - btn.getBoundingClientRect().right,
          };
        }
        return out;
      }, blockA);
    await expect.poll(async () => (await readCenter()) !== null, SETTLE).toBe(true);
    const center = (await readCenter())!;
    for (const col of colIds) {
      // The icon's center stands the cell's center (the border's half's
      // stand — the 1 px bottom border over the content's center). The
      // 0.01's epsilon: the stand's exact 0.5 stands the engine's
      // subpixel's read over it (the firefox's `getBoundingClientRect`
      // stands the 0.5000076's read).
      expect(Math.abs(center[col]?.deltaY ?? 1), `the ${col}'s vertical's delta`).toBeLessThanOrEqual(0.51);
      // The button's right edge stands the cell's right padding (the px-2's
      // stand — the right zone's regression: the Ellipsis stands right).
      expect(center[col]?.rightOffset, `the ${col}'s right's offset`).toBeCloseTo(8, 1);
    }

    // The menu's open stands the Ellipsis's press (the center's stand did
    // not break the trigger — the rename's input stands over the open).
    const btnA = a.locator(
      `[data-block-id='${blockA}'] [data-slot='docblocks/database-header-cell'][data-column-id='${colIds[0]}'] [data-slot='docblocks/database-column-menu']`
    );
    await btnA.click();
    expect(await a.locator("[data-slot='docblocks/database-rename-input']").count()).toBe(1);
  } finally {
    await close();
  }
});
