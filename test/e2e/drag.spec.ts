import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string, motion = false): Promise<void> {
  const suffix = motion ? "&motion=1" : "";
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}${suffix}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

/** The wrapper's gutter handle. */
function gutter(page: Page, client: "a" | "b", index: number) {
  return wrappers(page, client).nth(index).locator('button[data-slot="docblocks/gutter"]');
}

/** The wrapper's block id. */
async function wrapperId(page: Page, client: "a" | "b", index: number): Promise<string> {
  return (await wrappers(page, client).nth(index).getAttribute("data-block-id")) ?? "";
}

async function twoPanes(
  browser: Browser,
  room: string,
  motionA = false
): Promise<{
  a: Page;
  b: Page;
  close: () => Promise<void>;
}> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom, motionA);
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

/**
 * A real pointer drag from a gutter handle: hover, press, move in steps
 * (framer tracks the pointer moves), release.
 */
async function dragGutter(page: Page, client: "a" | "b", index: number, toX: number, toY: number): Promise<void> {
  const handle = gutter(page, client, index);
  await handle.hover();
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 16 });
  await page.mouse.up();
}

test("a gutter drag reorders the block, syncs to the plain pane, and undoes as one step", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui04b-reorder", true);

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(2);

  // Two more paragraphs via the insert control (the inserted block is
  // current, so it is labeled), with unique texts for the assertions.
  await a.getByTestId("block-btn-a").click();
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("one");
  await a.getByTestId("block-btn-a").click();
  await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("two");
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(4);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(4);

  const lastId = await wrapperId(a, "a", 3);
  expect(lastId).not.toBe("");
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  const lastBox = await wrappers(a, "a").nth(3).boundingBox();
  if (firstBox === null || lastBox === null) throw new Error("the wrappers have no boxes");

  // Drag the last block above the first one (the pointer lands inside the
  // viewport, so the drag does not trigger page auto-scroll).
  await dragGutter(a, "a", 3, lastBox.x + 20, firstBox.y + firstBox.height / 4);

  // The order changed in A and reached B over the wire (the plain pane
  // shows the new order as the update arrives).
  await expect(wrappers(a, "a").first(), SETTLE).toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first(), SETTLE).toHaveAttribute("data-block-id", lastId);

  // The drag is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes.
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").first(), SETTLE).not.toHaveAttribute("data-block-id", lastId);
  await expect(wrappers(b, "b").first(), SETTLE).not.toHaveAttribute("data-block-id", lastId);

  await close();
});

test("a drag back to the same position issues no command", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui04b-noop", true);

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const firstId = await wrapperId(a, "a", 0);
  expect(firstId).not.toBe("");

  // The wire log counts doc updates only (awareness frames do not pass
  // the logged sendUpdate), so a no-op drag adds no `out` line.
  const outCount = async (): Promise<number> =>
    (await a.getByTestId("wire-a").innerText()).match(/\] out \d+B/g)?.length ?? 0;
  const before = await outCount();

  const handleBox = await gutter(a, "a", 0).boundingBox();
  if (handleBox === null) throw new Error("the first wrapper's gutter has no box");
  // A small move: no midpoint crossing, so the order stands.
  await dragGutter(a, "a", 0, handleBox.x, handleBox.y + 4);

  await a.waitForTimeout(500);
  expect(await outCount()).toBe(before);
  await expect(wrappers(a, "a").first()).toHaveAttribute("data-block-id", firstId);

  await close();
});
