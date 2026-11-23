// The header's chrome's stand: the type's icon set over the name's left
// (the muted token's color), and the cursor's grab zone (the Ellipsis's
// pointer, the seam's col-resize's center).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane, twoPanes } from "./helpers";

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

/** The demo table's column ids by their schema names (the bridge's
 * schema read — the column ids stand the bridge's allocation, not the
 * spec's stand). */
async function demoColumns<K extends string>(
  page: Page,
  tableId: string,
  names: readonly K[]
): Promise<Record<K, string>> {
  const ids = await page.evaluate(
    async ({ tableId, names }) => {
      const { columns } = await window.__bridge!.describeTable(tableId);
      return names.map((name) => columns.find((column) => column.name === name)?.id ?? null);
    },
    { tableId, names }
  );
  const out = {} as Record<K, string>;
  names.forEach((name, index) => {
    const id = ids[index]!;
    if (id === null) throw new Error(`the demo table's "${name}" column stands absent`);
    out[name] = id;
  });
  return out;
}

test("the header's type icon stands left of the name (the 10 types' icon set; the muted token's color; the px-2 stands)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-typeicon-" + Math.random().toString(36).slice(2, 8));

    // The main table: one column per type (the 10). The ref columns' ref
    // tables stand (the enum's dict / the row's linked table).
    const { mainId, expected, colIds } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const dict = await bridge.createTable({ name: "TypeIcon-enum", system: true }, ctx());
      const dictId = dict.result.id;
      await bridge.createColumn(dictId, { column: { name: "name", type: "text", position: 0, nullable: true } }, ctx());
      await bridge.createColumn(
        dictId,
        { column: { name: "color", type: "text", position: 1, nullable: true } },
        ctx()
      );
      const link = await bridge.createTable({ name: "TypeIcon-link" }, ctx());
      const linkId = link.result.id;
      await bridge.createColumn(
        linkId,
        { column: { name: "Label", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const main = await bridge.createTable({ name: "TypeIcons" }, ctx());
      const mainId = main.result.id;
      const spec: {
        key: string;
        name: string;
        type: string;
        reference?: { kind: "enum" | "row"; tableId: string; many: boolean };
      }[] = [
        { key: "c_text", name: "Text", type: "text" },
        { key: "c_int", name: "Int", type: "integer" },
        { key: "c_dec", name: "Dec", type: "numeric" },
        { key: "c_bool", name: "Bool", type: "boolean" },
        { key: "c_date", name: "Date", type: "date" },
        { key: "c_dt", name: "DT", type: "timestamptz" },
        { key: "c_enum", name: "Enum", type: "text", reference: { kind: "enum", tableId: dictId, many: false } },
        { key: "c_multi", name: "Multi", type: "text", reference: { kind: "enum", tableId: dictId, many: true } },
        { key: "c_rowlink", name: "RL", type: "text", reference: { kind: "row", tableId: linkId, many: false } },
        {
          key: "c_rowlinks",
          name: "RLs",
          type: "text",
          reference: { kind: "row", tableId: linkId, many: true },
        },
      ];
      const colIds: Record<string, string> = {};
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
        colIds[s.key] = receipt.result.id;
      }
      return {
        mainId,
        colIds,
        expected: {
          c_text: "type",
          c_int: "hash",
          c_dec: "hash",
          c_bool: "circle-check",
          c_date: "calendar",
          c_dt: "calendar-clock",
          c_enum: "circle-chevron-down",
          c_multi: "list-checks",
          c_rowlink: "cable",
          c_rowlinks: "cable",
        },
      };
    });
    const blockA = await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), mainId);

    // The header's icon stand from one read (the grid's own DOM — no locator's
    // auto-wait / the strict-mode's stand over the grid's rows): per column,
    // the direct-child svg's shape signature (the svg's path data +
    // the line/rect/circle counts) + the icon's left of the name.
    const readIcons = (pane: Page) =>
      pane.evaluate((id) => {
        const grid = document.querySelector(
          `[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`
        ) as HTMLElement | null;
        if (grid === null) return null;
        const out: Record<string, { sig: string; iconLeftOfName: boolean }> = {};
        for (const cell of Array.from(
          grid.querySelectorAll<HTMLElement>('[data-slot="docblocks/database-header-cell"]')
        )) {
          const colId = cell.getAttribute("data-column-id")!;
          const icon = cell.querySelector<SVGElement>(":scope > svg");
          const nameSpan = cell.querySelector<HTMLElement>(":scope > span");
          if (icon === null || nameSpan === null) return null;
          const paths = Array.from(icon.querySelectorAll("path")).map((p) => p.getAttribute("d") ?? "");
          const sig = [
            `lines=${icon.querySelectorAll("line").length}`,
            `rects=${icon.querySelectorAll("rect").length}`,
            `circles=${icon.querySelectorAll("circle").length}`,
            `paths=${paths.join(",")}`,
          ].join(";");
          out[colId] = {
            sig,
            iconLeftOfName: icon.getBoundingClientRect().left < nameSpan.getBoundingClientRect().left,
          };
        }
        return out;
      }, blockA);

    // The markers the default SVG set stands (the mapping's parity over the
    // former icon's class read): per type, the distinctive element's count
    // + the path datum (the contains' stand over the full signature — the
    // shape's identity, not the byte's).
    const MARKERS: Record<string, string[]> = {
      type: ["circles=0;paths=", "M12 4v16", "M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"],
      hash: ["lines=4"],
      "circle-check": ["circles=1", "m16 9-5.5 5.5L8 12"],
      calendar: ["rects=1", "M3 9h18"],
      "calendar-clock": ["circles=1", "M16 14v2.2l1.6 1"],
      "circle-chevron-down": ["circles=1", "m16 10-4 4-4-4"],
      "list-checks": ["M13 5h8", "m3 17 2 2 4-4"],
      cable: ["M19 14V6.5a1 1 0 0 0-7 0v11a1 1 0 0 1-7 0V10"],
    };
    // The pane's icons stand the type's markers (the mapping) + the icon's
    // left of the name.
    await expect.poll(async () => (await readIcons(a)) !== null, SETTLE).toBe(true);
    const icons = (await readIcons(a))!;
    for (const [col, type] of Object.entries(expected)) {
      const columnId = colIds[col]!;
      for (const marker of MARKERS[type]!) {
        expect(icons[columnId]?.sig, `the ${col}'s icon's signature`).toContain(marker);
      }
      expect(icons[columnId]?.iconLeftOfName, `the ${col}'s icon's left of the name`).toBe(true);
    }

    // The icon's color resolves the muted-foreground token (the theme-
    // independent stand — the probe stands the token's resolved value).
    const iconColor = (pane: Page) =>
      pane.evaluate(
        ({ id, textColId }) => {
          const grid = document.querySelector(`[data-block-id="${id}"] [data-slot="docblocks/database-grid"]`)!;
          const icon = grid.querySelector<SVGElement>(
            `[data-slot="docblocks/database-header-cell"][data-column-id="${textColId}"] > svg`
          )!;
          const probe = document.createElement("div");
          probe.style.color = "var(--muted-foreground)";
          probe.style.position = "absolute";
          document.body.appendChild(probe);
          const token = getComputedStyle(probe).color;
          probe.remove();
          return { icon: getComputedStyle(icon).color, token };
        },
        { id: blockA, textColId: colIds.c_text }
      );
    // The dark stand (the explicit dark): the color resolves the token.
    await a.evaluate(() => document.documentElement.classList.add("dark"));
    const dark = await iconColor(a);
    expect(dark.icon).toBe(dark.token);
    // The light stand (the flip stands the resolution).
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    const light = await iconColor(a);
    expect(light.icon).toBe(light.token);
  } finally {
    await context.close();
  }
});

test("the header's cursor stands the grab zone (the Ellipsis's pointer; the seam's col-resize centered on the border)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "db-header-cursor");
  const demo = await bridgeDemoTable(a);
  await a.evaluate((tableId) => window.__paneDocs!.a!.insertBlock("database", { tableId }), demo.id);
  const gridA = a.locator("[data-slot='docblocks/database-grid']");
  await expect(gridA).toHaveCount(1, SETTLE);
  const { Title: titleColId } = await demoColumns(a, demo.id, ["Title"]);
  const titleHeader = a.locator(`[data-slot='docblocks/database-header-cell'][data-column-id='${titleColId}']`);
  await expect(titleHeader).toBeVisible(SETTLE);

  // The cell's grab (the drag's affordance) and the Ellipsis's button's
  // pointer (the menu's affordance) stand the header's cursor's zones.
  const cellCursor = await titleHeader.evaluate((el) => getComputedStyle(el).cursor);
  const btnCursor = await titleHeader
    .locator("[data-slot='docblocks/database-column-menu']")
    .evaluate((el) => getComputedStyle(el).cursor);
  expect(cellCursor).toBe("grab");
  expect(btnCursor).toBe("pointer");

  // The seam stands centered on the cell's right edge (the 3 px over each
  // side): the strip's center + the line's center stand the border (the
  // pointer over the line stands the stable col-resize).
  const seam = a.locator("[data-slot='docblocks/database-col-resize'][data-index='0']");
  const line = seam.locator("[data-slot='docblocks/database-col-resize-line']");
  const headerBox = (await titleHeader.boundingBox())!;
  const seamBox = (await seam.boundingBox())!;
  const lineBox = (await line.boundingBox())!;
  const borderX = headerBox.x + headerBox.width;
  expect(Math.abs(seamBox.x + seamBox.width / 2 - borderX)).toBeLessThanOrEqual(0.5);
  expect(Math.abs(lineBox.x + lineBox.width / 2 - borderX)).toBeLessThanOrEqual(0.5);
  expect(await seam.evaluate((el) => getComputedStyle(el).cursor)).toBe("col-resize");

  // The header's sweep stands the grab over the cells + the Ellipsis's
  // pointer + the col-resize's stand over the seams only (the auto stands
  // off the header's zone — the block's edge + the add-column's column
  // keep their own).
  const sweep = await a.evaluate(() => {
    const grid = document.querySelector("[data-slot='docblocks/database-grid']") as HTMLElement;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>("[data-slot='docblocks/database-header-cell']"));
    const first = cells[0]!.getBoundingClientRect();
    const last = cells[cells.length - 1]!.getBoundingClientRect();
    const set = new Set<string>();
    for (let x = first.left + 1; x <= last.right - 1; x += 2) {
      const el = document.elementFromPoint(x, first.top + first.height / 2);
      if (el !== null) set.add(getComputedStyle(el).cursor);
    }
    return Array.from(set);
  });
  expect(sweep).toEqual(expect.arrayContaining(["grab", "col-resize"]));
  expect(sweep.every((value) => ["grab", "pointer", "col-resize"].includes(value))).toBeTruthy();

  await close();
});
