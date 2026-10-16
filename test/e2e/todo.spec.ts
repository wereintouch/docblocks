import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
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
      // The done task's content stands at 30% opacity (the checked state
      // fades the text composition, never strikes it); the chrome stands
      // full (the checkbox is never faded).
      const wrapper = a.locator(`[data-slot="docblocks/list-item"][data-block-id="${id}"]`);
      const inner = wrapper.locator('[data-slot="docblocks/block-content"]');
      await expect(inner).toHaveCSS("opacity", "0.3");
      await expect(wrapper).toHaveCSS("opacity", "1");
      await expect(box).toHaveCSS("opacity", "1");
      await expect(inner).not.toHaveCSS("text-decoration-line", "line-through");

      await box.click();
      await expect(box).toHaveAttribute("aria-checked", "false");
      expect((await taskItem(a, "a", id))?.attrs).toMatchObject({ checked: false });
      await expect(inner).toHaveCSS("opacity", "1");
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

      // Pane b renders the checked state (attr + the faded content).
      const bBox = b.locator(`[data-block-id="${id}"] [data-slot="docblocks/checkbox"]`);
      await expect(bBox).toHaveAttribute("aria-checked", "true");
      const bWrapper = b.locator(`[data-slot="docblocks/list-item"][data-block-id="${id}"]`);
      const bInner = bWrapper.locator('[data-slot="docblocks/block-content"]');
      await expect(bInner).toHaveCSS("opacity", "0.3");
      await expect(bWrapper).toHaveCSS("opacity", "1");
      await expect(bInner).not.toHaveCSS("text-decoration-line", "line-through");
      expect((await taskItem(b, "b", id))?.attrs).toMatchObject({ checked: true });
    } finally {
      await close();
    }
  });
});

test.describe("todo conversion and split", () => {
  test("a checked task swapped to bullet loses its check (the text returns to normal, no strike)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "todo-convert");
    try {
      const id = await insertTaskItem(a, "a");
      await a.evaluate((blockId) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        doc.insertText(blockId, 0, "buy milk");
        doc.updateBlock(blockId, { checked: true });
      }, id);
      const block = a.locator(`[data-slot="docblocks/list-item"][data-block-id="${id}"]`);
      const inner = block.locator('[data-slot="docblocks/block-content"]');
      await expect(inner).toHaveCSS("opacity", "0.3");

      // Select the text and pick the list-type menu's Bulleted list.
      await inner.click();
      await a.keyboard.press("Home");
      await a.keyboard.press("Shift+End");
      const toolbar = a.locator('[data-slot="docblocks/format-toolbar"]');
      await expect(toolbar).toBeVisible();
      await toolbar.locator('button[aria-label="List type"]').click();
      await a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="bullet"]').click();

      // The swap: the kind stands bullet, the check is cleared, the
      // content returns to full opacity — no strike mark is synthesized.
      expect(await taskItem(a, "a", id)).toMatchObject({
        type: "list-item",
        attrs: { list: "bullet", checked: false },
      });
      await expect(inner).toHaveCSS("opacity", "1");
      await expect(inner).not.toHaveCSS("text-decoration-line", "line-through");
    } finally {
      await close();
    }
  });

  test("Enter after a checked task spawns an UNCHECKED item (no struck placeholder)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "todo-enter-split");
    try {
      const id = await insertTaskItem(a, "a");
      await a.evaluate((blockId) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        doc.insertText(blockId, 0, "buy milk");
        doc.updateBlock(blockId, { checked: true });
      }, id);
      const inner = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
      await inner.click();
      await a.keyboard.press("End");
      await a.keyboard.press("Enter");

      // The new sibling (right of the checked task): a task item whose
      // check stands unset (the default) — the block stands at full
      // opacity (its empty placeholder is never faded, never struck).
      const ids = await a.evaluate(() => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        return doc.getChildren(doc.meta.id);
      });
      const nextId = ids[ids.indexOf(id) + 1];
      expect(nextId, "the split should spawn a sibling").toBeDefined();
      expect(await taskItem(a, "a", nextId!)).toMatchObject({ type: "list-item", attrs: { list: "task" } });
      const next = await taskItem(a, "a", nextId!);
      expect(next?.attrs?.checked).toBeUndefined();
      const nextWrapper = a.locator(`[data-slot="docblocks/list-item"][data-block-id="${nextId}"]`);
      const nextInner = nextWrapper.locator('[data-slot="docblocks/block-content"]');
      await expect(nextInner).toHaveCSS("opacity", "1");
      await expect(nextInner).not.toHaveCSS("text-decoration-line", "line-through");
      const nextBox = a.locator(`[data-block-id="${nextId}"] [data-slot="docblocks/checkbox"]`);
      await expect(nextBox).toHaveAttribute("aria-checked", "false");
    } finally {
      await close();
    }
  });

  test("a strike mark on the text survives the conversion to a task (the mark is data; the check mutes, never strikes)", async ({
    browser,
  }) => {
    const { a, close } = await twoPanes(browser, "todo-mark-keep");
    try {
      // A paragraph with a struck run (the user's mark data).
      const id = await a.evaluate(() => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        const p = doc.insertBlock("paragraph");
        doc.insertText(p, 0, "struck");
        doc.setMark(p, 0, 6, { type: "strike" });
        return p;
      });
      const inner = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/block-content"]`);
      await expect(inner.locator("s")).toHaveCSS("text-decoration-line", "line-through");

      // Convert to a task list item through the list-type menu.
      await inner.click();
      await a.keyboard.press("Home");
      await a.keyboard.press("Shift+End");
      const toolbar = a.locator('[data-slot="docblocks/format-toolbar"]');
      await expect(toolbar).toBeVisible();
      await toolbar.locator('button[aria-label="List type"]').click();
      await a.locator('[data-slot="docblocks/format-list-menu"] [data-list-option="task"]').click();

      // The mark stands (user data — the strike keeps its style), the
      // checkbox is fresh and unchecked (the block stands at full
      // opacity).
      const item = await taskItem(a, "a", id);
      expect(item?.attrs).toMatchObject({ list: "task" });
      expect(item?.attrs?.checked).toBeUndefined();
      const runs = await a.evaluate((blockId) => {
        const doc = window.__paneDocs?.a;
        if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
        return doc.getRuns(blockId);
      }, id);
      expect(runs).toEqual([{ text: "struck", marks: { strike: true } }]);
      await expect(inner.locator("s")).toHaveCSS("text-decoration-line", "line-through");
      await expect(inner).toHaveCSS("opacity", "1");

      // Checking the box fades the content to 30% opacity (on top of the
      // strike mark) — the mark's strike and the check's fade are
      // independent states; the checkbox stands full.
      const box = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/checkbox"]`);
      await box.click();
      await expect(inner).toHaveCSS("opacity", "0.3");
      await expect(box).toHaveCSS("opacity", "1");
      await expect(inner.locator("s")).toHaveCSS("text-decoration-line", "line-through");
    } finally {
      await close();
    }
  });
});
