// The page's motion row layer — the pointer's gestures over the rows: the
// gutter drag's slide (the crossed sibling's animation in flight, the commit
// over the wire, the undo's single step), the deletion's exit animation
// (completing in both panes), and the mid-document insert (only the new row
// animates — existing rows never restart the enter animation).
import { type Page, expect, test } from "@playwright/test";

import { insertBlockType, rowsSettled, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/row"]');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

test("a real-pointer gutter drag slides the crossed sibling, commits over the wire, and undoes as one step", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "gutter-drag-slide");

  // The room's starter; the insert makes two
  // (the harness insert — no typing, deterministic under parallel load).
  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  const thirdId = await insertBlockType(a, "a", "paragraph");
  await rowsSettled(a);

  // A non-dragged row's layout animation writes a non-identity inline
  // transform on its Reorder.Item (a group's direct child) while the slide
  // is in flight. Wait for it from the Node side (a 20 ms CDP poll — an
  // in-page rAF sampler is starved by the other spec's pages in a parallel
  // run). The dragged row carries its own projection too — so exclude it:
  // the pin is the crossed sibling's slide.
  const slid = a.waitForFunction(
    (draggedId) => {
      const group = document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/rows"]');
      if (group === null) return false;
      return Array.from(group.children).some(
        (c) =>
          c instanceof HTMLElement &&
          c.querySelector("[data-block-id]")?.getAttribute("data-block-id") !== draggedId &&
          c.style.transform !== "" &&
          c.style.transform !== "none" &&
          c.style.transform !== "matrix(1, 0, 0, 1, 0, 0)"
      );
    },
    thirdId,
    { polling: 20, timeout: 5_000 }
  );

  // A real pointer drag of the third row's gutter handle above the first
  // row's top (slow steps so the browser renders between moves and the
  // crossed row's slide is in flight mid-drag). The pointer stops well
  // above the first row's center, so the commit's virtual index is 0
  // unambiguously (framer decides off the dragged row's projected position,
  // which tracks the pointer).
  const handle = wrappers(a, "a").nth(2).locator('button[data-slot="docblocks/gutter"]');
  const handleBox = await handle.boundingBox();
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  if (handleBox === null || firstBox === null) throw new Error("no handle/first boxes");
  const fromY = handleBox.y + handleBox.height / 2;
  const dy = fromY - (firstBox.y - 10);
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(handleBox.x, fromY - (dy * i) / 12);
    await a.waitForTimeout(35);
  }
  await a.mouse.up();
  // The slide runs out (it started when the drag crossed mid-drag).
  await slid;

  // The drag committed: the dragged block is first now, in both panes
  // (the commit left the pane over the wire).
  const order = await wrappers(a, "a").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
  expect(order[0]).toBe(thirdId);
  await expect(wrappers(b, "b").nth(0)).toHaveAttribute("data-block-id", thirdId);

  // The move is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes. The undo hotkey reaches the doc only
  // from inside the editor root, so click back in first (the drag left the
  // focus outside).
  await wrappers(a, "a").nth(0).locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").nth(0)).not.toHaveAttribute("data-block-id", thirdId);
  await expect(wrappers(b, "b").nth(0)).not.toHaveAttribute("data-block-id", thirdId);

  await close();
});

test("a gutter deletion disappears in both panes (the exit animation completes)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "gutter-deletion-exit");

  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  await expect(wrappers(a, "a")).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");

  // The exit animation runs out (the leaving row stays in the layout flow
  // and collapses) and the block is gone in both panes.
  await expect(wrappers(a, "a")).toHaveCount(before - 1);
  await expect(wrappers(b, "b")).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});

test("a mid-document insert animates only the new row (existing rows never restart the enter animation)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "insert-no-restart");
  try {
    // Three paragraphs, and an open enter-animation gate (A types).
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("one");
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("two");
    await expect(wrappers(a, "a")).toHaveCount(3);
    await rowsSettled(a);

    // Watch every existing row's style attribute: the contract is that none
    // of them ever stands a numeric (mid-animation) height while the new
    // row runs its enter — a restarted enter would write the height values
    // from the ENTER geometry (a collapse and regrowth).
    const watchIds = await a.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="doc-a"] [data-slot="docblocks/row"]')
      );
      const seen: Record<string, string[]> = {};
      (window as unknown as { __restartWatch: unknown }).__restartWatch = { seen, stop: null as null | (() => void) };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== "attributes" || record.attributeName !== "style") continue;
          const row = record.target as HTMLElement;
          const key = row.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? "?";
          const height = row.style.height;
          if (height !== "" && height !== "auto") {
            (seen[key] ??= []).push(height);
          }
        }
      });
      for (const row of rows) observer.observe(row, { attributes: true, attributeFilter: ["style"] });
      (window as unknown as { __restartWatch: { stop: null | (() => void) } }).__restartWatch.stop = () =>
        observer.disconnect();
      return rows.map((row) => row.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? "?");
    });
    expect(watchIds).toHaveLength(3);

    // The insert (mid-document, after the second row).
    await a.evaluate((afterId) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: afterId });
    }, watchIds[1]);
    await expect(wrappers(a, "a")).toHaveCount(4);
    await rowsSettled(a);

    // No existing row ran a height animation: the recorded numeric heights
    // are absent (the new row's own enter animation is out of scope — it
    // was not under observation).
    const numericHeights = await a.evaluate(() => {
      const watch = (window as unknown as { __restartWatch: { seen: Record<string, string[]>; stop: () => void } })
        .__restartWatch;
      watch.stop();
      return watch.seen;
    });
    expect(Object.values(numericHeights).flat()).toEqual([]);
  } finally {
    await close();
  }
});
