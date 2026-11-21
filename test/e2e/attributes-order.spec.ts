// The document-attributes panel — the custom rows' drag reorder over the
// grip (the blocks' grip's offset parity, the live preview's slide, the
// release's commit over the wire, the undo's single step) and the no-move
// grip release's no-write's stand (the values and the order stand untouched
// over the settle window).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, expectStays, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the
// 15s SETTLE's panes + the page loads): the raised budget keeps the
// timeout class out of the loaded machine's flake zone (a true stall
// stays visible).
test.setTimeout(45_000);

/** The pane's doc JSON (a stable string — the no-data-write pin). */
async function jsonOf(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return "";
      return JSON.stringify(doc.toJSON());
    },
    { client }
  );
}

const panel = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/attributes"]`);
const body = (page: Page, client: "a" | "b") => panel(page, client).locator('[data-slot="docblocks/attributes-body"]');
const toggle = (page: Page, client: "a" | "b") =>
  panel(page, client).locator('[data-slot="docblocks/attributes-toggle"]');

/** Expands the panel (the collapse state is the session's — the default: collapsed). */
async function openPanel(page: Page, client: "a" | "b"): Promise<void> {
  await toggle(page, client).click();
  await body(page, client).waitFor({ state: "visible" });
}

/** The pane's `meta.attributesOrder` array (null over the field's absent stand). */
async function attrOrderOf(page: Page, client: "a" | "b"): Promise<string[] | null> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return null;
      return doc.meta.attributesOrder ?? null;
    },
    { client }
  );
}

/** The custom rows' display order (the panel's DOM order over the custom group). */
const customRows = (page: Page, client: "a" | "b") =>
  body(page, client).locator('[data-slot="docblocks/attributes-custom"] [data-slot="docblocks/attribute-row"]');

/**
 * A real pointer drag from a point to a point (the press/move/release
 * mechanics): move in steps (framer's layout projection tracks the
 * pointer only across rendered frames — a single fast move is batched
 * and crosses nothing), then the dwell (the layout projection's slide
 * (0.18s) settles, so the release's commit stands over the settled
 * boxes).
 */
async function pressDragTo(page: Page, fromX: number, fromY: number, toX: number, toY: number): Promise<void> {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(fromX + (toX - fromX) * (i / 12), fromY + ((toY - fromY) * i) / 12);
    await page.waitForTimeout(30);
  }
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.move(toX, toY);
    await page.waitForTimeout(30);
  }
  await page.mouse.up();
}

test("the custom attribute's drag reorder over the grip (the blocks' grip's offset parity, the live preview's slide, the release's commit over the wire, the undo's single step)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-reorder");
  try {
    // The three custom keys over the command (the add's flow's parity is
    // pinned over its own test).
    await a.evaluate(() => {
      const d = window.__paneDocs?.a ?? null;
      if (d === null) throw new Error("pane A's doc is not mounted");
      d.setAttribute("alpha", "1");
      d.setAttribute("beta", "2");
      d.setAttribute("gamma", "3");
    });
    await openPanel(a, "a");
    const rows = customRows(a, "a");
    await expect(rows).toHaveCount(3);
    expect(await rows.nth(0).getAttribute("data-attribute-key")).toBe("alpha");
    expect(await rows.nth(1).getAttribute("data-attribute-key")).toBe("beta");
    expect(await rows.nth(2).getAttribute("data-attribute-key")).toBe("gamma");

    // The grip's offset stands the block's grip's column (the same
    // `--docblocks-gutter-left` token over the same page column — the
    // horizontal parity with the block's rows).
    const grip = panel(a, "a").locator('[data-slot="docblocks/attribute-row-grip"][data-attribute-key="gamma"]');
    await grip.hover();
    const gripBox = await grip.boundingBox();
    const blockGrip = a.locator('[data-testid="doc-a"] [data-slot="docblocks/gutter"]').first();
    const blockGripBox = await blockGrip.boundingBox();
    if (gripBox === null || blockGripBox === null) throw new Error("the grip has no box");
    expect(Math.abs(gripBox.x - blockGripBox.x)).toBeLessThan(2);

    // Drag the last custom row above the first (the press over the
    // grip's center).
    const firstBox = await rows.nth(0).boundingBox();
    if (firstBox === null) throw new Error("the first row has no box");
    await pressDragTo(
      a,
      gripBox.x + gripBox.width / 2,
      gripBox.y + gripBox.height / 2,
      firstBox.x + 40,
      firstBox.y + firstBox.height / 4
    );

    // The panel's order stands the drop (the release's commit — one
    // command, the values stand untouched).
    expect(await rows.nth(0).getAttribute("data-attribute-key")).toBe("gamma");
    expect(await rows.nth(1).getAttribute("data-attribute-key")).toBe("alpha");
    expect(await rows.nth(2).getAttribute("data-attribute-key")).toBe("beta");
    await expect.poll(() => attrOrderOf(a, "a"), SETTLE).toEqual(["gamma", "alpha", "beta"]);
    // The order stands the doc's data (the JSON export's field — the
    // reload's persistence) and reaches pane B over the wire (its panel's
    // display over the sync).
    await expect
      .poll(() => jsonOf(a, "a").then((json) => JSON.parse(json).attributesOrder as string[] | undefined), SETTLE)
      .toEqual(["gamma", "alpha", "beta"]);
    await expect.poll(() => attrOrderOf(b, "b"), SETTLE).toEqual(["gamma", "alpha", "beta"]);
    await openPanel(b, "b");
    const rowsB = customRows(b, "b");
    expect(await rowsB.nth(0).getAttribute("data-attribute-key")).toBe("gamma");
    expect(await rowsB.nth(1).getAttribute("data-attribute-key")).toBe("alpha");
    expect(await rowsB.nth(2).getAttribute("data-attribute-key")).toBe("beta");

    // The drag is A's local undo entry (one command, one undoable unit):
    // the order reverts in both panes.
    await a.keyboard.press("Control+z");
    await expect.poll(() => attrOrderOf(a, "a"), SETTLE).toEqual(["alpha", "beta", "gamma"]);
    await expect.poll(() => attrOrderOf(b, "b"), SETTLE).toEqual(["alpha", "beta", "gamma"]);
    expect(await rows.nth(0).getAttribute("data-attribute-key")).toBe("alpha");
  } finally {
    await close();
  }
});

test("a no-move grip release issues no reorder (the values and the order stand untouched)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-reorder-noop");
  try {
    await a.evaluate(() => {
      const d = window.__paneDocs?.a ?? null;
      if (d === null) throw new Error("pane A's doc is not mounted");
      d.setAttribute("alpha", "1");
      d.setAttribute("beta", "2");
    });
    await openPanel(a, "a");
    const rows = customRows(a, "a");
    await expect(rows).toHaveCount(2);
    // A press + a small move (no row's crossing — the framer reorder's
    // no-fire stand: the preview stands never, the release's commit
    // stands the no-write).
    const grip = panel(a, "a").locator('[data-slot="docblocks/attribute-row-grip"][data-attribute-key="beta"]');
    await grip.hover();
    const box = await grip.boundingBox();
    if (box === null) throw new Error("the grip has no box");
    await pressDragTo(a, box.x + box.width / 2, box.y + box.height / 2, box.x + box.width / 2, box.y + 4);
    // The release's no-write's stand: the order stands over the settle
    // window (a late commit lands after a single sample).
    await expectStays(async () => {
      expect(await rows.nth(0).getAttribute("data-attribute-key")).toBe("alpha");
      expect(await rows.nth(1).getAttribute("data-attribute-key")).toBe("beta");
      expect(await attrOrderOf(a, "a")).toEqual(["alpha", "beta"]);
    });
  } finally {
    await close();
  }
});
