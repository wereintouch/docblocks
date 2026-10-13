import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

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

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

async function twoPanes(
  browser: Browser,
  room: string
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

test("an inserted block reaches both panes and its enter animation settles", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-insert");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);

  await insertBlockType(a, "a", "paragraph");

  // Both panes (the motion editor) render the block as it arrives...
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(3);
  // ...and the enter animation settles in A (the block is current after
  // the insert, so it is labeled).
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(3);
  await expect
    .poll(
      async () => await currentWrapper(a, "a").evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      SETTLE
    )
    .toBe("1");
  await expect(currentWrapper(a, "a")).toBeVisible();

  await close();
});

test("an in-place line break reflows without a size projection (the text is never scaled)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03c-linebreak");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const content = wrappers(a, "a").nth(0).locator('[data-slot="docblocks/block-content"]');
  await content.click();
  await a.keyboard.type("hello");
  await a.keyboard.press("Shift+Enter");

  // The content height changed in place, so no entry may carry a framer
  // transform at ANY point — a size projection would be mid-scale on the
  // changed entry and distorting its text for ~450ms. Sample three times
  // over the first ~120ms: the old projection's window is longer than any
  // sample spread, so a loaded runner cannot slip past it.
  const entryTransforms = () =>
    pane(a, "a").evaluate((root) => {
      const group = root.querySelector("[data-docblocks-motion] > div");
      if (group === null) return null;
      return Array.from(group.children)
        .filter((c) => c instanceof HTMLElement)
        .map((el) => el.style.transform);
    });
  const midTransforms: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = await entryTransforms();
    expect(t).not.toBeNull();
    midTransforms.push(...t!);
    if (i < 2) await a.waitForTimeout(60);
  }
  // `none` / the identity matrix: an active projection would carry a scale
  // or an offset here.
  expect(midTransforms.every((t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);

  // The break landed in the doc (a newline in the run text, not a new
  // block) and settled clean (no projection left armed behind).
  const text = await a.evaluate(
    (id) => {
      const block = window.__paneDocs?.a?.getBlock(id);
      return block?.content?.map((r) => r.text).join("") ?? null;
    },
    (await wrappers(a, "a").nth(0).getAttribute("data-block-id")) ?? ""
  );
  expect(text).toBe("hello\n");
  await expect
    .poll(
      async () =>
        await pane(a, "a").evaluate((root) => {
          const group = root.querySelector("[data-docblocks-motion] > div");
          if (group === null) return "no-group";
          return Array.from(group.children)
            .filter((c) => c instanceof HTMLElement)
            .map((el) => el.style.transform)
            .join(";");
        }),
      SETTLE
    )
    .toBe("none;none");

  await close();
});

test("a gutter deletion disappears in both panes (the exit animation completes)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-delete");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");

  // The exit animation runs out (the leaving entry is popped out of the
  // layout) and the block is gone in both panes.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(before - 1);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});
