// The document-attributes panel over the editor page column (the consumer's
// own document metadata — the markdown frontmatter's stand): the
// collapsed-by-default stand (the session state — no doc write over the
// toggle), the system rows (id / created / the live last updated), the
// preset editors (description / the tags' chips; the status stands
// display-only — the consumer's data) + the system rows (the locale's
// committing one `setAttribute` each and syncing over the wire to the
// second pane, the custom attributes (add / edit / remove), and the
// view-mode's display-only stand. The panel stands over the page's shared
// editable (a non-editable island), so the canvas view never renders it.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, toCanvas, twoPanes } from "./helpers";

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

test("the panel stands collapsed over the page column (the toggle's no doc write, the canvas's absence)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-collapse");
  try {
    // The panel renders over the page column (above the first block),
    // collapsed by default (the body is absent over the stand).
    await expect(toggle(a, "a")).toBeVisible();
    await expect(body(a, "a")).toHaveCount(0);
    const before = await jsonOf(a, "a");
    await toggle(a, "a").click();
    await body(a, "a").waitFor({ state: "visible" });
    // The toggle's no doc write (the session state only).
    expect(await jsonOf(a, "a")).toBe(before);
    // The canvas view never renders the panel (the page column's stand).
    await toCanvas(a, "a");
    await expect(a.locator('[data-slot="docblocks/attributes"]')).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the description edit commits one setAttribute and syncs to the second pane (the panel's stand over both)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-description");
  try {
    await openPanel(a, "a");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-description"]').click();
    const input = panel(a, "a").locator('[data-slot="docblocks/attributes-description-edit"]');
    await input.fill("The first line");
    await input.press("Enter");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.description), SETTLE).toBe("The first line");
    // Pane B's JSON stands the synced attribute; its panel's display.
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.description), SETTLE).toBe("The first line");
    await openPanel(b, "b");
    await expect(body(b, "b").locator('[data-slot="docblocks/attributes-description"]')).toHaveText("The first line");
  } finally {
    await close();
  }
});

test("the tags' chips: the add over Enter, the chip's removal, the empty backspace's attribute removal", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-tags");
  try {
    await openPanel(a, "a");
    const input = panel(a, "a").locator('[data-slot="docblocks/attributes-tag-input"]');
    await input.pressSequentially("alpha", { delay: 20 });
    await input.press("Enter");
    await input.pressSequentially("beta", { delay: 20 });
    await input.press("Enter");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.tags), SETTLE).toEqual(["alpha", "beta"]);
    // The first chip's removal (the chip's remove button).
    await panel(a, "a")
      .locator('[data-slot="docblocks/attributes-tag"]', { hasText: "alpha" })
      .locator("[data-slot='docblocks/attributes-tag-remove']")
      .click();
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.tags), SETTLE).toEqual(["beta"]);
    // The empty input's Backspace: the last tag's removal (the stand
    // empties out — the attribute stands removed).
    await input.press("Backspace");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.tags), SETTLE).toBeUndefined();
  } finally {
    await close();
  }
});

test("the status's row stands display-only (the consumer's data over the wire — the panel's editors stand absent)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-status");
  try {
    // The consumer's write over the command (the package's status's editor
    // stands absent — the consumer's own stand passes the value).
    await a.evaluate(() => {
      const d = window.__paneDocs?.a ?? null;
      if (d === null) throw new Error("pane A's doc is not mounted");
      d.setAttribute("status", "published");
    });
    await openPanel(a, "a");
    // The display-only stand: no select, no remove button over the row.
    await expect(panel(a, "a").locator('[data-slot="docblocks/attributes-status"]')).toHaveCount(0);
    await expect(
      panel(a, "a").locator(
        '[data-slot="docblocks/attribute-row"][data-attribute-key="status"] [data-slot="docblocks/attribute-row-remove"]'
      )
    ).toHaveCount(0);
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.status), SETTLE).toBe("published");
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.status), SETTLE).toBe("published");
    await openPanel(b, "b");
    await expect(
      panel(b, "b").locator('[data-slot="docblocks/attribute-row"][data-attribute-key="status"]')
    ).toHaveText(/published/);
  } finally {
    await close();
  }
});

test("the custom attribute: the typed add over the popover's flow / the value's edit / the row's removal (the wire over both)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-custom");
  try {
    await openPanel(a, "a");
    /** The add's flow (the list's tail's button over the popover): the type
     *  pick + the name's draft + the commit (the row's creation over the
     *  type's initial form — the data stands the typed wrapper). */
    const addAttribute = async (type: string, name: string): Promise<void> => {
      await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
      const popover = a.locator('[data-slot="docblocks/attributes-add-key"]');
      await popover.waitFor({ state: "visible" });
      await a.locator(`[data-slot="docblocks/attributes-add-type"] [data-type="${type}"]`).click();
      await popover.fill(name);
      await a.locator('[data-slot="docblocks/attributes-add-confirm"]').click();
      await expect(popover).toHaveCount(0);
    };
    // The number's initial form (the type's picker over the popover — the
    // button stands over the list's tail over the commit).
    await addAttribute("number", "revision");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.revision), SETTLE)
      .toEqual({
        type: "number",
        value: 0,
      });
    // The number's value's edit over the row's zone (the typed form's
    // write-back — the type stands kept over the new value).
    await panel(a, "a").locator('[data-slot="docblocks/attribute-custom"][data-attribute-key="revision"]').click();
    const revisionEdit = panel(a, "a").locator('[data-slot="docblocks/attribute-revision-edit"]');
    await revisionEdit.fill("12");
    await revisionEdit.press("Enter");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.revision), SETTLE)
      .toEqual({
        type: "number",
        value: 12,
      });
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.revision), SETTLE)
      .toEqual({
        type: "number",
        value: 12,
      });
    // The default type (string) over the second custom key.
    await addAttribute("string", "note");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE)
      .toEqual({
        type: "string",
        value: "",
      });
    // The value's edit (the typed string's stand — the custom row's inline
    // edit keeps the typed form over the commit).
    await panel(a, "a").locator('[data-slot="docblocks/attribute-custom"][data-attribute-key="note"]').click();
    const edit = panel(a, "a").locator('[data-slot="docblocks/attribute-note-edit"]');
    await edit.fill("nine");
    await edit.press("Enter");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE)
      .toEqual({
        type: "string",
        value: "nine",
      });
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.note), SETTLE)
      .toEqual({
        type: "string",
        value: "nine",
      });
    // The mention's stand (the name stands the target's id — the id-only
    // reference; the display stands the id over the monospace).
    await addAttribute("mention", "u7");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.u7), SETTLE)
      .toEqual({
        type: "mention",
        value: { id: "u7" },
      });
    await expect(panel(a, "a").locator('[data-slot="docblocks/attribute-row"][data-attribute-key="u7"]')).toHaveText(
      /u7/
    );
    // The mention's value's edit (the id's write-back over the row's zone
    // — the same placeholder's stand as the other value's inputs).
    await panel(a, "a").locator('[data-slot="docblocks/attribute-custom"][data-attribute-key="u7"]').click();
    const mentionEdit = panel(a, "a").locator('[data-slot="docblocks/attribute-u7-edit"]');
    expect(await mentionEdit.getAttribute("placeholder")).toBe("Value");
    await mentionEdit.fill("u9");
    await mentionEdit.press("Enter");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.u7), SETTLE)
      .toEqual({
        type: "mention",
        value: { id: "u9" },
      });
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.u7), SETTLE)
      .toEqual({
        type: "mention",
        value: { id: "u9" },
      });
    // The row's removal (the custom row's remove button).
    await panel(a, "a")
      .locator(
        '[data-slot="docblocks/attribute-row"][data-attribute-key="note"] [data-slot="docblocks/attribute-row-remove"]'
      )
      .click();
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE).toBeUndefined();
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.note), SETTLE).toBeUndefined();
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
    // row and the tag's input absent.
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-description"]')).toHaveText("Read-only line");
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-add"]')).toHaveCount(0);
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-tag-input"]')).toHaveCount(0);
    // The sync's stand over the mode (the attribute is the doc's data —
    // the view keeps the live doc).
    await expect(body(a, "a").locator('[data-slot="docblocks/attributes-description"]')).toHaveText("Read-only line");
  } finally {
    await close();
  }
});
