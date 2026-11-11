import { expect, test } from "@playwright/test";

import { editorContext } from "./helpers";

test("playground shell loads", async ({ page }) => {
  // Its own room: a manually left-over tab must not pollute the sync specs.
  await page.goto(`/?syncUrl=ws://localhost:5199/smoke-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page).toHaveTitle(/docblocks playground/);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
});

test("the stale persisted bridge's snapshot adopts the canonical demo's stand (the seed's upsert)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  // The stale stand planted BEFORE the app's load (the persisted v2
  // snapshot: the Demo's table over the standing rows' pk's ids — the
  // Status's column stands the enum's reference out (the ref-less stand —
  // the upsert's adoption's target), no system table, no Projects; the
  // standing rows keep their pk's ids, and demo-1's count carries a user
  // edit the upsert must not clobber). The seed's upsert must bring it to
  // the canonical form (the stale table).
  await page.addInitScript(() => {
    const stale = {
      tables: [
        {
          id: "table-demo",
          name: "Demo",
          columns: [
            { id: "c-table-demo-1", name: "Title", type: "text", position: 0, nullable: true, revision: "" },
            { id: "c-table-demo-2", name: "Count", type: "integer", position: 1, nullable: true, revision: "" },
            { id: "c-table-demo-3", name: "Done", type: "boolean", position: 2, nullable: true, revision: "" },
            { id: "c-table-demo-4", name: "Status", type: "text", position: 3, nullable: true, revision: "" },
          ],
          rows: [
            {
              id: "r-table-demo-1",
              orderKey: 1,
              revision: "",
              cells: { "c-table-demo-1": "First task", "c-table-demo-2": 42, "c-table-demo-3": false },
            },
            {
              id: "r-table-demo-2",
              orderKey: 2,
              revision: "",
              cells: { "c-table-demo-1": "Second task", "c-table-demo-2": 2, "c-table-demo-3": true },
            },
            {
              id: "r-table-demo-3",
              orderKey: 3,
              revision: "",
              cells: {
                "c-table-demo-1": "Third task",
                "c-table-demo-2": 3,
                "c-table-demo-3": false,
                "c-table-demo-4": "r-table-statuses-enum-2",
              },
            },
          ],
        },
      ],
    };
    window.localStorage.setItem("docblocks-playground-bridge-v2", JSON.stringify(stale));
  });
  await page.goto(`/?client=a&syncUrl=ws://localhost:5199/seed-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The upsert stands (the bridge's reads await the seed's readiness):
  // the stale Status's column stands the enum's reference (the adoption),
  // the system table stands its options (the colors over the `color`
  // column), the standing rows keep their pk's ids (no loss — the user's
  // count edit survives), the status cell stands the doing option's row id
  // (the identity over the restore), and the missing Projects stands
  // created (the six columns).
  const stand = () =>
    page.evaluate(async () => {
      const bridge = window.__bridge;
      if (bridge === undefined) return null;
      const demo = await bridge.describeTable("table-demo");
      const status = demo.columns.find((column) => column.name === "Status");
      if (status === undefined) return null;
      const enumSnapshot = await bridge.snapshotTable("table-statuses-enum", {});
      const enumNameId = enumSnapshot.columns.find((column) => column.name === "name")?.id;
      const enumColorId = enumSnapshot.columns.find((column) => column.name === "color")?.id;
      if (enumNameId === undefined || enumColorId === undefined) return null;
      const todoOption = enumSnapshot.page.rows.find((row) => row.cells[enumNameId] === "todo");
      const doingOption = enumSnapshot.page.rows.find((row) => row.cells[enumNameId] === "doing");
      const demoSnapshot = await bridge.snapshotTable("table-demo", {});
      const demoTitleId = demoSnapshot.columns.find((column) => column.name === "Title")?.id;
      const demoCountId = demoSnapshot.columns.find((column) => column.name === "Count")?.id;
      const demoStatusId = demoSnapshot.columns.find((column) => column.name === "Status")?.id;
      if (demoTitleId === undefined || demoCountId === undefined || demoStatusId === undefined) return null;
      const projects = await bridge.describeTable("table-projects");
      return {
        status: { type: status.type, reference: status.reference ?? null },
        optionCount: enumSnapshot.page.rows.length,
        todoColor: (todoOption?.cells[enumColorId] as string | undefined) ?? null,
        demoCount: demoSnapshot.page.rows.length,
        demo1Count: (demoSnapshot.page.rows[0]?.cells[demoCountId] as number | undefined) ?? null,
        demo3Title: (demoSnapshot.page.rows[2]?.cells[demoTitleId] as string | undefined) ?? null,
        demo3Status: (demoSnapshot.page.rows[2]?.cells[demoStatusId] as string | undefined) ?? null,
        doingOptionId: doingOption?.id ?? null,
        projectsColumns: projects.columns.length,
      };
    });
  await expect.poll(stand, { timeout: 15_000 }).toMatchObject({
    status: { type: "text", reference: { kind: "enum", tableId: "table-statuses-enum", many: false } },
    optionCount: 3,
    todoColor: "#f4e07d",
    demoCount: 3,
    demo1Count: 42,
    demo3Title: "Third task",
    projectsColumns: 6,
  });
  const final = await stand();
  // The standing status cell stands the doing option's row id (the cell's
  // value is the option's stable id, the label is never the identity).
  expect(final?.doingOptionId).not.toBeNull();
  expect(final?.demo3Status).toBe(final?.doingOptionId);
  await context.close();
});
