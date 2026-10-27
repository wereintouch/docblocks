import { expect, test } from "@playwright/test";

test("playground shell loads", async ({ page }) => {
  // Its own room: a manually left-over tab must not pollute the sync specs.
  await page.goto(`/?syncUrl=ws://localhost:5199/smoke-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page).toHaveTitle(/docblocks playground/);
  await expect(page.getByTestId("status-a")).toHaveText("connected");
});

test("the stale persisted bridge's snapshot adopts the canonical demo's stand (the seed's upsert)", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  // The legacy stand planted BEFORE the app's load (the persisted
  // snapshot: the Demo's table over the legacy select's options stand —
  // no ref, no colors — no system table, no Projects; the standing rows
  // keep their pk's ids, and demo-3's title carries a user edit the
  // upsert must not clobber). The seed's upsert must bring it to the
  // canonical form (the stale table).
  await page.addInitScript(() => {
    const legacy = {
      tables: [
        {
          name: "Demo",
          columns: [
            { id: "title", name: "Title", type: "text" },
            { id: "count", name: "Count", type: "integer" },
            { id: "done", name: "Done", type: "boolean" },
            { id: "status", name: "Status", type: "select", options: ["todo", "doing", "done"] },
          ],
          rows: [
            { id: "demo-1", cells: { title: "First task", count: 1, done: false, status: "todo" } },
            { id: "demo-2", cells: { title: "Second task", count: 2, done: true, status: "done" } },
            { id: "demo-3", cells: { title: "Third task (user edit)", count: 3, done: false, status: "doing" } },
          ],
        },
      ],
    };
    window.localStorage.setItem("docblocks-playground-bridge-v1", JSON.stringify(legacy));
  });
  await page.goto(`/?client=a&syncUrl=ws://localhost:5199/seed-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The upsert stands (the bridge's reads await the seed's readiness):
  // the legacy status's column stands the enum's ref, the system table
  // stands its options (the colors over the `color` column), the standing
  // rows adopt over the pk (no loss — the user's title edit survives), and
  // the missing Projects stands created (the six columns).
  const stand = () =>
    page.evaluate(async () => {
      const bridge = window.__bridge;
      if (bridge === undefined) return null;
      const demo = await bridge.describeTable("table-demo");
      const status = demo.columns.find((column) => column.id === "status");
      if (status === undefined) return null;
      const options = await bridge.queryRows("table-statuses-enum", {});
      const demoRows = await bridge.queryRows("table-demo", {});
      const projects = await bridge.describeTable("table-projects");
      return {
        status: { type: status.type, refKind: status.refKind, refTableId: status.refTableId },
        optionCount: Object.keys(options.rows).length,
        todoColor: (options.rows["todo"]?.color as string | undefined) ?? null,
        demoCount: Object.keys(demoRows.rows).length,
        demo3Title: (demoRows.rows["demo-3"]?.title as string | undefined) ?? null,
        demo3Status: (demoRows.rows["demo-3"]?.status as string | undefined) ?? null,
        projectsColumns: projects.columns.length,
      };
    });
  await expect.poll(stand, { timeout: 15_000 }).toEqual({
    status: { type: "text", refKind: "enum", refTableId: "table-statuses-enum" },
    optionCount: 3,
    todoColor: "#f4e07d",
    demoCount: 3,
    demo3Title: "Third task (user edit)",
    demo3Status: "doing",
    projectsColumns: 6,
  });
  await context.close();
});
