import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

/**
 * Insert a task list item into the pane's doc (the pane's harness doc
 * handle) and return its id.
 */
async function insertTaskItem(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const rootId = doc.toJSON().id;
    return doc.insertBlock("list-item", { list: "task" }, { parent: rootId });
  }, client);
}

/** The pane's task item block snapshot (attrs + content), read from its doc. */
async function taskItem(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(
    ({ c, blockId }) => {
      const doc = window.__paneDocs?.[c];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      return doc.getBlock(blockId);
    },
    { c: client, blockId: id }
  );
}

async function twoPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await openPane(a, "a", room);
  await openPane(b, "b", room);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

test.describe("todo checkbox", () => {
  test("renders the checkbox and toggles the checked attr on click", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "todo-cb");
    try {
      const id = await insertTaskItem(a, "a");
      const box = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/checkbox"]`);
      await expect(box).toBeVisible();
      await expect(box).toHaveAttribute("aria-checked", "false");
      // The pane's seeded paragraph renders without a checkbox.
      await expect(a.locator('[data-slot="docblocks/checkbox"]')).toHaveCount(1);

      await box.click();
      await expect(box).toHaveAttribute("aria-checked", "true");
      const after = await taskItem(a, "a", id);
      expect(after?.attrs).toMatchObject({ checked: true });
      // The done task's text is struck through.
      const inner = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
      await expect(inner).toHaveCSS("text-decoration-line", "line-through");

      await box.click();
      await expect(box).toHaveAttribute("aria-checked", "false");
      expect((await taskItem(a, "a", id))?.attrs).toMatchObject({ checked: false });
      await expect(inner).not.toHaveCSS("text-decoration-line", "line-through");
    } finally {
      await close();
    }
  });

  test("the toggle syncs across panes", async ({ browser }) => {
    const { a, b, close } = await twoPanes(browser, "todo-cb-sync");
    try {
      const id = await insertTaskItem(a, "a");
      // Wait until the item has reached pane b's doc.
      await b.waitForFunction(
        (blockId) => {
          const doc = window.__paneDocs?.b;
          return (
            doc !== null && doc !== undefined && doc.getBlock(blockId) !== null && doc.getBlock(blockId) !== undefined
          );
        },
        id,
        SETTLE
      );

      const box = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/checkbox"]`);
      await expect(box).toBeVisible();
      await box.click();

      // Pane b renders the checked state (attr + strikethrough).
      const bBox = b.locator(`[data-block-id="${id}"] [data-slot="docblocks/checkbox"]`);
      await expect(bBox).toHaveAttribute("aria-checked", "true", SETTLE);
      const bInner = b.locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
      await expect(bInner).toHaveCSS("text-decoration-line", "line-through", SETTLE);
      expect((await taskItem(b, "b", id))?.attrs).toMatchObject({ checked: true });
    } finally {
      await close();
    }
  });
});
