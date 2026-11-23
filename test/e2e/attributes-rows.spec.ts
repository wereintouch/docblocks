// The document-attributes panel — the row's stands: the type picker's pill
// over the popover's reopen (the entry animation's no-stand — the
// measurement's scale compensation), the system rows' locale's dates (the
// date only — not the raw ISO), and the view mode's display-only stand (the
// editors off, the rows over the sync).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, slotEntered, twoPanes } from "./helpers";

// The two-pane's settle stands the default 30s budget at its edge (the
// 15s SETTLE's panes + the page loads): the raised budget keeps the
// timeout class out of the loaded machine's flake zone (a true stall
// stays visible).
test.setTimeout(45_000);

/** The pane's `meta.attributes` record (null over the field's absent stand). */
async function attributesOf(page: Page, client: "a" | "b"): Promise<Record<string, unknown> | null> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return null;
      return doc.meta.attributes ?? null;
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

test("the type picker's pill stands over the popover's reopen (the entry animation's no-stand — the measurement's scale compensation)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-type-pill");
  try {
    await openPanel(a, "a");
    // The popover's open (the default type — the string's stand).
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
    const nameInput = a.locator('[data-slot="docblocks/attributes-add-key"]');
    await nameInput.waitFor({ state: "visible" });
    // The last type's pick (the mention's stand — the pill's travel over
    // the picker's width) + the close (the type's keep over the draft's
    // reset).
    await a.locator('[data-slot="docblocks/attributes-add-type"] [data-type="mention"]').click();
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
    await expect(nameInput).toHaveCount(0);
    // The reopen: the pill's stand over the mention (the entry's zoom's
    // no-stand — the measurement over the scale's factor stands the
    // untransformed geometry over the animation's frames).
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
    await nameInput.waitFor({ state: "visible" });
    // The entry's animation's stand (the state-based's settle — the
    // opacity's 1 + the transform's rest over the settled element).
    await slotEntered(a, "popover-content");
    const pillBox = await a.locator('[data-slot="docblocks/attributes-add-type-pill"]').boundingBox();
    const buttonBox = await a
      .locator('[data-slot="docblocks/attributes-add-type"] [data-type="mention"]')
      .boundingBox();
    if (pillBox === null || buttonBox === null) throw new Error("the pill or the button has no box");
    // The pill's stand over the mention's button (the left's + the width's
    // parity — the offset's < 1px's stand over the animation's frame).
    expect(Math.abs(pillBox.x - buttonBox.x)).toBeLessThan(1);
    expect(Math.abs(pillBox.width - buttonBox.width)).toBeLessThan(1);
  } finally {
    await close();
  }
});

test("the system rows stand the locale's dates (the date only — not the raw ISO)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-dates");
  try {
    await openPanel(a, "a");
    // The locale's date stand (the consumer's `html lang` over the panel's
    // locale; the date only — the ISO's `T` separator never stands):
    // both date rows carry a year and keep no time part.
    for (const key of ["createdAt", "updatedAt"]) {
      const rowText = await body(a, "a")
        .locator(`[data-slot="docblocks/attribute-row"][data-attribute-key="${key}"]`)
        .textContent();
      expect(rowText).toMatch(/20\d\d/);
      expect(rowText).not.toContain("T");
    }
    // The id's monospace stand (the technical identifier's display):
    // the row's value zone (the 2nd span — the label's column stands the 1st).
    const idRow = body(a, "a").locator('[data-slot="docblocks/attribute-row"][data-attribute-key="id"] div span');
    expect(await idRow.evaluate((el) => window.getComputedStyle(el).fontFamily)).toMatch(/mono/i);
  } finally {
    await close();
  }
});

test("the view mode stands the panel display-only (the editors off, the rows over the sync)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-readonly");
  try {
    // Seed an attribute over the wire (pane A's edit mode).
    await openPanel(a, "a");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-description"]').click();
    const input = panel(a, "a").locator('[data-slot="docblocks/attributes-description-edit"]');
    await input.fill("Read-only line");
    await input.press("Enter");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.description), SETTLE).toBe("Read-only line");
    // The view mode's stand (the mode switcher's pin over the doc header).
    await a.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
    // The body stands display-only: the description's display, the add's
    // row and the tag's add affordance absent (the chips stand their
    // display's stand — the events' no-affordance's stand).
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-description"]')).toHaveText("Read-only line");
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-add"]')).toHaveCount(0);
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-tag-add"]')).toHaveCount(0);
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-tag-remove"]')).toHaveCount(0);
    // The sync's stand over the mode (the attribute is the doc's data —
    // the view keeps the live doc).
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-description"]')).toHaveText("Read-only line");
  } finally {
    await close();
  }
});
