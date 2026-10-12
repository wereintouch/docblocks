import { type Browser, type Page, expect, test } from "@playwright/test";

// The list-drag session (the motion subpath): a list item of any level is
// dragged by its gutter handle within its own list run (same level only),
// a line marks the drop slot, and the release commits one moveBlock.
// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
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

/** One block's children order ("" for the root). */
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

/** A pointer drag of a list item's gutter into a slot of the same run. */
async function dragListItem(
  page: Page,
  client: "a" | "b",
  fromId: string,
  targetId: string,
  side: "before" | "after"
): Promise<void> {
  const fromWrapper = block(page, client, fromId);
  const targetWrapper = block(page, client, targetId);
  const fromBox = await fromWrapper.boundingBox();
  const targetBox = await targetWrapper.boundingBox();
  if (fromBox === null || targetBox === null) throw new Error("the list items have no boxes");
  const gutter = fromWrapper.locator('button[data-slot="docblocks/gutter"]');
  await gutter.hover();
  await page.mouse.down();
  // Keep the pointer inside the list's horizontal band (the session
  // offers no slot outside it).
  const x = targetBox.x + 24;
  const y = side === "before" ? targetBox.y + 4 : targetBox.y + targetBox.height - 4;
  await page.mouse.move(x, y, { steps: 16 });
  await page.mouse.up();
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

/** Seeds a bullet run of `count` items at the root and returns their ids in order. */
async function seedBulletRun(page: Page, client: "a" | "b", count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await page.evaluate((c) => {
      const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
      return d === null ? null : d.insertBlock("list-item", { list: "bullet" });
    }, client);
    if (id === null) throw new Error("the pane's doc is not mounted");
    ids.push(id);
  }
  return ids;
}

/** Seeds a nested bullet under `parentId` and returns the child's id. */
async function seedNestedBullet(page: Page, client: "a" | "b", parentId: string): Promise<string> {
  const id = await page.evaluate(
    ({ c, parentId }) => {
      const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
      return d === null ? null : d.insertBlock("list-item", { list: "bullet" }, { parent: parentId });
    },
    { c: client, parentId }
  );
  if (id === null) throw new Error("the pane's doc is not mounted");
  return id;
}

test("a top-level list item drags to the top of the run and syncs to the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "listdrag-top");

  const [l1, l2, l3] = await seedBulletRun(a, "a", 3);
  await expect.poll(() => rootOrder(a, "a"), SETTLE).toContain(l3);

  // Drag the last item above the first (the slot before the run's head).
  await dragListItem(a, "a", l3, l1, "before");

  const expected = await rootOrder(a, "a");
  expect(expected.indexOf(l3)).toBeLessThan(expected.indexOf(l1));
  expect(expected.indexOf(l3)).toBeLessThan(expected.indexOf(l2));
  expect(expected.indexOf(l1)).toBeLessThan(expected.indexOf(l2));

  // The other pane shows the new order (the update arrived over the wire).
  await expect.poll(() => rootOrder(b, "b"), SETTLE).toEqual(expected);

  // The lift visual is gone after the release.
  await expect(block(a, "a", l3)).not.toHaveAttribute("data-docblocks-dragging");

  await close();
});

test("a nested list item drags within its own level and syncs to the other pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "listdrag-nested");

  const [parent] = await seedBulletRun(a, "a", 1);
  const nested = [await seedNestedBullet(a, "a", parent), await seedNestedBullet(a, "a", parent)];

  await expect.poll(() => childrenOrder(a, "a", parent), SETTLE).toEqual(nested);

  // Drag the nested item below the parent over the first nested item.
  await dragListItem(a, "a", nested[1], nested[0], "before");

  const after = await childrenOrder(a, "a", parent);
  expect(after).not.toEqual(null);
  expect(after![0]).toBe(nested[1]);
  expect(after![1]).toBe(nested[0]);

  // The other pane sees the new nested order.
  await expect.poll(() => childrenOrder(b, "b", parent), SETTLE).toEqual(after);

  await close();
});

test("a list item dragged back to its own slot issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "listdrag-noop");

  const [l1, l2] = await seedBulletRun(a, "a", 2);

  // The wire log counts doc updates only (awareness frames do not pass
  // the logged sendUpdate), so a no-op drag adds no `out` line.
  const outCount = async (): Promise<number> =>
    (await a.getByTestId("wire-a").innerText()).match(/\] out \d+B/g)?.length ?? 0;
  const before = await outCount();

  // A small vertical move: the pointer stays in the item's own row (the
  // slot before its next sibling is its own slot), so the release commits
  // nothing.
  await dragListItem(a, "a", l1, l1, "before");

  await a.waitForTimeout(500);
  expect(await outCount()).toBe(before);
  expect(await rootOrder(a, "a")).toContain(l1);
  expect(await rootOrder(a, "a")).toContain(l2);

  await close();
});

test("a list item dropped outside the run's band is rejected (the order stands)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "listdrag-reject");

  const [parent] = await seedBulletRun(a, "a", 1);
  const n1 = await seedNestedBullet(a, "a", parent);

  const before = await rootOrder(a, "a");
  const nestedBefore = await childrenOrder(a, "a", parent);

  // Drag the nested item far to the left (outside the run's horizontal
  // band — over the page margin): the session offers no slot, so the
  // drop is rejected.
  const fromWrapper = block(a, "a", n1);
  const fromBox = await fromWrapper.boundingBox();
  if (fromBox === null) throw new Error("the nested item has no box");
  const gutter = fromWrapper.locator('button[data-slot="docblocks/gutter"]');
  await gutter.hover();
  await a.mouse.down();
  await a.mouse.move(5, fromBox.y + 30, { steps: 16 });
  await a.mouse.up();

  await a.waitForTimeout(300);
  expect(await rootOrder(a, "a")).toEqual(before);
  expect(await childrenOrder(a, "a", parent)).toEqual(nestedBefore);
  // Nothing was committed, so the other pane is unchanged too.
  expect(await rootOrder(b, "b")).toEqual(before);

  await close();
});
