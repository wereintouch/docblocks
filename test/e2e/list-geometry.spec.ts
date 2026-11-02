/**
 * The list row's visible geometry (the checkbox-to-text clearance and the
 * numbered marker's first-line axis): the only two un-pinned visible
 * geometries over the list rows.
 *
 */
import { type Page, expect, test } from "@playwright/test";

import { twoPanes } from "./helpers";

/** Insert a flat list row of the given type and return its id. */
async function insertListItem(page: Page, list: "task" | "number" | "bullet"): Promise<string> {
  return page.evaluate((l) => {
    const doc = window.__paneDocs?.["a"];
    if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
    const rootId = doc.toJSON().id;
    const id = doc.insertBlock("list-item", { list: l }, { parent: rootId });
    doc.insertText(id, 0, "row");
    return id;
  }, list);
}

/** The gap in px between the checkbox's right edge and the row text's left edge. */
async function checkboxGapPx(page: Page, id: string): Promise<number> {
  return page.evaluate((blockId) => {
    const box = document.querySelector(`[data-block-id="${blockId}"] [data-slot="docblocks/checkbox"]`);
    const content = document.querySelector(`[data-block-id="${blockId}"] [data-slot="docblocks/block-content"]`);
    if (box === null || content === null) throw new Error("the checkbox / the content is not rendered");
    const boxRect = box.getBoundingClientRect();
    // The text's left edge: the content element's padding box start (the
    // marker zone stands outside it — the zone is the row's padding).
    const contentRect = content.getBoundingClientRect();
    return contentRect.left - boxRect.right;
  }, id);
}

test.describe("the list row's visible geometry", () => {
  test("L1: the checkbox-to-text clearance stands the token's gap (24px zone − 16px checkbox)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "list-geometry-l1");
    try {
      const id = await insertListItem(a, "task");
      const gap = await checkboxGapPx(a, id);
      // The zone is the --docblocks-marker-width token (16px checkbox +
      // the gap-2 clearance): the clearance is 8px (the gap-2 token over
      // the marker's 16px stand).
      expect(gap).toBeCloseTo(8, 0);
    } finally {
      await close();
    }
  });

  test("L2: the numbered marker stands on the first line's axis, muted (light + dark)", async ({ browser }) => {
    const { a, close } = await twoPanes(browser, "list-geometry-l2");
    try {
      const id = await insertListItem(a, "number");
      const marker = a.locator(`[data-block-id="${id}"] [data-slot="docblocks/row-marker"]`);
      await expect(marker).toHaveCount(1);

      // The marker's own line box equals the row's first line box
      // (inherited font size / line height): top: 0 centers the glyph
      // on the first text line (the former 0.25em offset is gone).
      expect(await marker.evaluate((el) => getComputedStyle(el).top)).toBe("0px");

      // The muted color stands the standard token (the seed's light /
      // dark set over the consumer's own --muted-foreground): the marker
      // stands the value the token resolves to (the hex fallback stands
      // only when the consumer defines no token at all). The light /
      // dark values must also differ (the dark flip's stand).
      const read = () =>
        marker.evaluate((el) => ({
          token: getComputedStyle(el).getPropertyValue("--muted-foreground").trim(),
          color: getComputedStyle(el).color,
        }));
      // The harness loads dark by default: the light read pins the light
      // class state first (the un-pinned read would stand the harness
      // default's dark values under both reads).
      await a.evaluate(() => document.documentElement.classList.remove("dark"));
      const light = await read();
      expect(light.color, `the light marker stands the muted token (${light.token})`).toBe(
        light.token !== "" ? light.token : "#57606a"
      );

      // The dark set flips the token's value.
      await a.evaluate(() => document.documentElement.classList.add("dark"));
      const dark = await read();
      expect(dark.color, `the dark marker stands the muted token (${dark.token})`).toBe(
        dark.token !== "" ? dark.token : "#8b949e"
      );
      expect(dark.color, "the dark stand stands the light's flip").not.toBe(light.color);
    } finally {
      await close();
    }
  });
});
