// The collapse's stand over the flat page model's derived segments: the
// toggle unmounts the segment locally (view state, per pane — no wire
// traffic, the other pane stands, the data stands) and re-mounts it on
// expand, plus the collapse triangle's fill/visibility states over the
// non-list block.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, outCount, rowsSettled, twoPanes } from "./helpers";

/** One block's snapshot (the pane's live doc). */
async function blockOf(page: Page, client: "a" | "b", id: string) {
  return page.evaluate(
    ({ client, id }) => {
      const d = window.__paneDocs?.[client];
      if (d === null || d === undefined) throw new Error("the pane's doc is not mounted");
      return d.getBlock(id);
    },
    { client, id }
  );
}

/** One block's indent attr (absent is 0 — the writer omits the default). */
async function indentOf(page: Page, client: "a" | "b", id: string): Promise<number | undefined> {
  const block = await blockOf(page, client, id);
  const attrs = (block?.attrs ?? {}) as { indent?: number };
  return attrs.indent;
}

test("the collapse toggle unmounts the derived segment locally (no wire traffic, the other pane stands)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "collapse-segment-unmount");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const item = d.insertBlock("list-item", { list: "bullet" });
    d.insertText(item, 0, "parent");
    const child = d.insertBlock("list-item", { list: "bullet", indent: 1 });
    d.insertText(child, 0, "child");
    return { item, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  // Both panes render the item and its nested child row.
  await expect(a.locator(`[data-block-id="${seeded.item}"]`).first()).toBeVisible();
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  await expect(b.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  const wireA = await outCount(a, "a");

  const toggle = a
    .locator(`[data-block-id="${seeded.item}"]`)
    .first()
    .locator('> button[data-slot="docblocks/collapse"]');
  // The expanded-state toggle reveals on a wrapper hover (like the grip).
  await a.locator(`[data-block-id="${seeded.item}"]`).first().hover();
  await expect(toggle).toBeVisible();
  await toggle.click();

  // The segment unmounts in A only (view state, per pane): the child row
  // is gone from A's DOM, stands in B, and the toggle issued no doc
  // update (the wire log stands).
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toHaveCount(0);
  await expect(b.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(wireA);
  });
  // The data stands: the child keeps its indent in the doc.
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  // The expand re-mounts the segment.
  await toggle.click();
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  await close();
});

// The collapse triangle on a NON-list block (the flat model's derived
// segment stands under any text block) and its visual states: the triangle
// is filled in both states (pointing down while expanded, right while
// collapsed, in the block's text color); the expanded state reveals on a
// wrapper hover like the grip, the collapsed one is always visible; the
// hover raises the muted square highlight.
test("the collapse triangle: a paragraph's derived segment and the fill/visibility states", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "collapse-paragraph-segment");

  const seeded = await a.evaluate(() => {
    const d = window.__paneDocs?.a ?? null;
    if (d === null) return null;
    const parent = d.insertBlock("paragraph");
    d.insertText(parent, 0, "parent");
    const child = d.insertBlock("paragraph", { indent: 1 });
    d.insertText(child, 0, "child");
    return { parent, child };
  });
  if (seeded === null) throw new Error("the pane's doc is not mounted");
  await rowsSettled(a);

  const row = a.locator(`[data-block-id="${seeded.parent}"]`).first();
  const toggle = row.locator('> button[data-slot="docblocks/collapse"]');
  const triangle = toggle.locator("svg");

  // Expanded state: hidden until a wrapper hover; the filled triangle
  // points down.
  await expect(toggle).toHaveCSS("opacity", "0");
  await row.hover();
  await expect(toggle).toHaveCSS("opacity", "1");
  expect(await triangle.evaluate((el) => getComputedStyle(el).fill)).not.toBe("none");
  await expect(triangle).toHaveCSS("rotate", "180deg");
  // The text color, not the gutter's muted (the element the locator
  // resolved, no re-query).
  const colors = await row.evaluate((el) => {
    const svg = el.querySelector(":scope > button[data-slot='docblocks/collapse'] svg");
    return { fill: getComputedStyle(svg!).fill, color: getComputedStyle(el).color };
  });
  expect(colors.fill).not.toBe("none");
  expect(colors.fill).toBe(colors.color);
  // The hover highlight: the muted square behind the triangle (the button's
  // own hover — the pointer stands on the toggle, not just the row). The
  // background reads the muted token (not the ghost variant's accent).
  // The button's transition-all animates it in — wait for the settled
  // value (the state-based stand).
  await toggle.hover();
  await expect
    .poll(
      () =>
        toggle.evaluate((el) => {
          const cs = getComputedStyle(el);
          return (
            cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor === cs.getPropertyValue("--muted").trim()
          );
        }),
      SETTLE
    )
    .toBe(true);
  const hoverBg = await toggle.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      matchesMuted: cs.backgroundColor === cs.getPropertyValue("--muted").trim(),
    };
  });
  expect(hoverBg.bg).not.toBe("rgba(0, 0, 0, 0)");
  expect(hoverBg.matchesMuted).toBe(true);

  // Collapse: the derived segment unmounts (view state — the data stands,
  // no wire update), the triangle turns right, and it stays visible
  // without the hover.
  const wireA = await outCount(a, "a");
  await toggle.click();
  await a.mouse.move(5, 5); // leave the wrapper: the hover is off
  await expect(toggle).toHaveCSS("opacity", "1");
  await expect(triangle).toHaveCSS("rotate", "90deg");
  expect(await triangle.evaluate((el) => getComputedStyle(el).fill)).not.toBe("none");
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toHaveCount(0);
  await expectStays(async () => {
    expect(await outCount(a, "a")).toBe(wireA);
  });
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  // Expand re-mounts the segment.
  await row.hover();
  await toggle.click();
  await expect(a.locator(`[data-block-id="${seeded.child}"]`).first()).toBeVisible();
  expect(await indentOf(a, "a", seeded.child)).toBe(1);

  await close();
});
