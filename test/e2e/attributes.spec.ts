// The document-attributes panel over the editor page column (the consumer's
// own document metadata — the markdown frontmatter's stand): the
// collapsed-by-default stand (the session state — no doc write over the
// toggle), the system rows (id / created / the live last updated), the
// preset editors (description / the tags' chips / the status's select)
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

test("the status's select commits the preset value and syncs (the empty option's removal)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-status");
  try {
    await openPanel(a, "a");
    const select = panel(a, "a").locator('[data-slot="docblocks/attributes-status"]');
    await select.selectOption("draft");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.status), SETTLE).toBe("draft");
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.status), SETTLE).toBe("draft");
    await select.selectOption("");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.status), SETTLE).toBeUndefined();
  } finally {
    await close();
  }
});

test("the custom attribute: the add / the value's edit / the row's removal (the wire over both)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-custom");
  try {
    await openPanel(a, "a");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-key"]').fill("revision");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-value"]').fill("7");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
    // The numeric stand (the value's parse over the add's input).
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.revision), SETTLE).toBe(7);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.revision), SETTLE).toBe(7);
    // The value's edit (the string stand — the custom row's inline edit
    // opens over the string values; the numeric add's stand is the
    // display-only's parity over the non-string forms).
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-key"]').fill("note");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-value"]').fill("hello");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-add-button"]').click();
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE).toBe("hello");
    await panel(a, "a").locator('[data-slot="docblocks/attribute-custom"][data-attribute-key="note"]').click();
    const edit = panel(a, "a").locator('[data-slot="docblocks/attribute-note-edit"]');
    await edit.fill("nine");
    await edit.press("Enter");
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE).toBe("nine");
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.note), SETTLE).toBe("nine");
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
