import { type Browser, type Page, expect, test } from "@playwright/test";

// The block-drag session over the text-container children (the motion
// subpath): a child of a text container (the Tab-nested content) drags by
// its gutter handle like a list item — the hovered row's vertical half
// names the side and its horizontal band the level (a pointer in a row's
// right band drops the block into a hovered container as its first child,
// the registry's child types deciding), anywhere else it drops at the
// hovered row's level (re-parenting across containers or back to the
// root). A line marks the slot, and the release commits one moveBlock.
// Each test gets its own room via ?syncUrl= (the relay keeps rooms for the
// dev server's lifetime, so a shared room would be polluted).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's wrapper of one block id (the first match — ids are unique). */
function block(page: Page, client: "a" | "b", id: string) {
  return pane(page, client).locator(`[data-block-id="${id}"]`).first();
}

/** The pane's root children order (the command API's view). */
function rootOrder(page: Page, client: "a" | "b") {
  return page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    return d === null ? [] : d.getChildren(d.toJSON().id);
  }, client);
}

/** One block's children order. */
function childrenOrder(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(
    ({ c, id }) => {
      const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
      if (d === null) return null;
      return d.toJSON().blocks[id]?.children ?? null;
    },
    { c: client, id }
  );
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** Seeds a paragraph with two paragraph children (text-container nesting) and a root paragraph after it; returns the ids. */
async function seedContainer(page: Page, client: "a" | "b") {
  const ids = await page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) return null;
    const parent = d.insertBlock("paragraph", undefined, { parent: d.toJSON().id });
    d.insertText(parent, 0, "parent");
    const c1 = d.insertBlock("paragraph", undefined, { parent });
    d.insertText(c1, 0, "child one");
    const c2 = d.insertBlock("paragraph", undefined, { parent, after: c1 });
    d.insertText(c2, 0, "child two");
    const after = d.insertBlock("paragraph", undefined, { parent: d.toJSON().id, after: parent });
    d.insertText(after, 0, "after");
    return { parent, c1, c2, after };
  }, client);
  if (ids === null) throw new Error("the pane's doc is not mounted");
  return ids;
}

/**
 * A pointer drag of a block's gutter into a slot of the target row.
 * `xOffset` positions the pointer inside the target row: a small offset
 * names the side slot, an offset past 1.5 run-indents the nested slot
 * (into the target, when it is a list item or a text container).
 */
async function dragInto(
  page: Page,
  client: "a" | "b",
  fromId: string,
  targetId: string,
  side: "before" | "after",
  xOffset = 24
): Promise<void> {
  // Let the seeded entries' enter animations settle (the boxes must be
  // stable before the drag's geometry is read).
  await page.waitForTimeout(600);
  const fromWrapper = block(page, client, fromId);
  const targetWrapper = block(page, client, targetId);
  const fromBox = await fromWrapper.boundingBox();
  const targetBox = await targetWrapper.boundingBox();
  if (fromBox === null || targetBox === null) throw new Error("the blocks have no boxes");
  const gutter = fromWrapper.locator('> button[data-slot="docblocks/gutter"]');
  await gutter.hover();
  await page.mouse.down();
  const x = targetBox.x + xOffset;
  const y = side === "before" ? targetBox.y + 4 : targetBox.y + targetBox.height - 4;
  await page.mouse.move(x, y, { steps: 16 });
  await page.mouse.up();
}

test("a text-container child drags to a sibling slot within its container and syncs", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "nested-drag-within");
  const { parent, c1, c2 } = await seedContainer(a, "a");

  // c1 (the first child) drops after c2 — a reorder within the container.
  await dragInto(a, "a", c1, c2, "after");

  const children = (c: "a" | "b") => childrenOrder(c === "a" ? a : b, c, parent);
  await expect.poll(() => children("a"), SETTLE).toEqual([c2, c1]);
  await expect.poll(() => children("b"), SETTLE).toEqual([c2, c1]);
  // The container itself stays at the root (nothing escaped).
  await expect.poll(() => rootOrder(a, "a"), SETTLE).toContain(parent);

  await close();
});

test("a text-container child drags out to the root level and syncs", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "nested-drag-out");
  const { parent, c1, c2, after } = await seedContainer(a, "a");

  // The room carries the panes' own seed blocks; the expectation is the
  // pre-drag order with c1 inserted before the "after" paragraph.
  const pre = await rootOrder(a, "a");
  const expected = [...pre];
  expected.splice(expected.indexOf(after), 0, c1);

  // c1 drops at the root, before the "after" paragraph.
  await dragInto(a, "a", c1, after, "before");

  await expect.poll(() => rootOrder(a, "a"), SETTLE).toEqual(expected);
  await expect.poll(() => rootOrder(b, "b"), SETTLE).toEqual(expected);
  await expect.poll(() => childrenOrder(a, "a", parent), SETTLE).toEqual([c2]);
  await expect.poll(() => childrenOrder(b, "b", parent), SETTLE).toEqual([c2]);

  await close();
});

test("a text-container child dropped in a container's right band becomes its first child", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "nested-drag-into");
  const { parent, c1, c2, after } = await seedContainer(a, "a");

  // c1 drops into the "after" container's right band (past 1.5 indents):
  // it becomes that container's first child.
  await dragInto(a, "a", c1, after, "before", 48);

  await expect.poll(() => childrenOrder(a, "a", after), SETTLE).toEqual([c1]);
  await expect.poll(() => childrenOrder(b, "b", after), SETTLE).toEqual([c1]);
  await expect.poll(() => childrenOrder(a, "a", parent), SETTLE).toEqual([c2]);

  await close();
});

test("a text-container child dropped in its own container's band becomes its first child", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "nested-drag-self");
  const { parent, c1, c2 } = await seedContainer(a, "a");

  // c2 (the second child) drops into its own container's right band: the
  // into-slot reorders it to the first child of the same container.
  await dragInto(a, "a", c2, parent, "before", 48);

  await expect.poll(() => childrenOrder(a, "a", parent), SETTLE).toEqual([c2, c1]);
  await expect.poll(() => childrenOrder(b, "b", parent), SETTLE).toEqual([c2, c1]);

  await close();
});

test("a text-container child dragged back to its own slot issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "nested-drag-noop");
  const { c1, c2 } = await seedContainer(a, "a");

  // The wire log counts doc updates only (awareness frames do not pass the
  // logged sendUpdate), so a no-op drag adds no `out` line.
  const outCount = async (): Promise<number> =>
    (await a.getByTestId("wire-a").innerText()).match(/\] out \d+B/g)?.length ?? 0;
  const before = await outCount();

  // A small drag that stays on c2's before-side (c1's own slot).
  const fromWrapper = block(a, "a", c1);
  const targetWrapper = block(a, "a", c2);
  const fromBox = await fromWrapper.boundingBox();
  const targetBox = await targetWrapper.boundingBox();
  if (fromBox === null || targetBox === null) throw new Error("the blocks have no boxes");
  const gutter = fromWrapper.locator('> button[data-slot="docblocks/gutter"]');
  await gutter.hover();
  await a.mouse.down();
  await a.mouse.move(targetBox.x + 24, targetBox.y + 4, { steps: 8 });
  await a.mouse.up();

  await a.waitForTimeout(500);
  expect(await outCount()).toBe(before);
  await expect(block(a, "a", c1)).toBeVisible();

  await close();
});
