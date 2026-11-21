// The document-attributes panel over the editor page column (the consumer's
// own document metadata — the markdown frontmatter's stand): the
// collapsed-by-default stand (the session state — no doc write over the
// toggle, the canvas's absence), the preset rows' consumer contracts (the
// description's built-in / the consumer-owned stand — the document's
// no-write's stand, the tags' consumer-owned chips — the document's
// no-write's stand), and the status's display-only stand (the consumer's
// data — the panel's editors stand absent). The panel stands over the page's
// shared editable (a non-editable island), so the canvas view never renders
// it.
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

test("the tags' consumer contract: the chips over the passed list, the add's click, the chip's removal (the document's no-write's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-tags", { attrDemo: true });
  try {
    // The dialog's stand (the harness's prompt's creation over the add's
    // click): the accept over the name (the consumer's flow's stand).
    a.on("dialog", async (dialog) => {
      if (dialog.type() === "prompt") await dialog.accept("gamma");
      else await dialog.dismiss();
    });
    await openPanel(a, "a");
    const zone = panel(a, "a").locator('[data-slot="docblocks/attributes-tags"]');
    // The consumer's list's display (the demo's seed over the pane's store
    // — the document's record stands no `tags`'s entry).
    await expect(zone.locator('[data-slot="docblocks/attributes-tag"]')).toHaveText(["alpha", "beta"]);
    // The add affordance's click: the consumer's creation's UI (the
    // prompt) stands the updated list over the prop (the round-trip).
    await zone.locator('[data-slot="docblocks/attributes-tag-add"]').click();
    await expect
      .poll(() => zone.locator('[data-slot="docblocks/attributes-tag"]').allTextContents(), SETTLE)
      .toEqual(["alpha", "beta", "gamma"]);
    // The chip's removal (the chip's `x`'s click): the consumer's store's
    // update stands the display (the prop's round-trip — the package
    // writes nothing).
    await zone
      .locator('[data-slot="docblocks/attributes-tag"]', { hasText: "alpha" })
      .locator("[data-slot='docblocks/attributes-tag-remove']")
      .click();
    await expect
      .poll(() => zone.locator('[data-slot="docblocks/attributes-tag"]').allTextContents(), SETTLE)
      .toEqual(["beta", "gamma"]);
    // The document's stand: the tags are never document data (the record
    // stands no `tags` — the consumer's store is the source).
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.tags), SETTLE).toBeUndefined();
  } finally {
    await close();
  }
});

test("the description's consumer contract: the value over the passed read, the edit's report over the callback (the document's no-write's stand)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-attributes-description-consumer", { attrDemo: true });
  try {
    await openPanel(a, "a");
    const zone = panel(a, "a").locator('[data-slot="docblocks/attributes-description"]');
    // The consumer's store's display (the demo's seed over the pane's state
    // — the document's record stands no `description`'s entry).
    await expect(zone).toHaveText("The consumer's description");
    // The edit's flow: the display's click opens the inline input; the
    // commit reports over the consumer's callback (the prop's round-trip —
    // the package writes nothing to the document).
    await zone.click();
    const input = panel(a, "a").locator('[data-slot="docblocks/attributes-description-edit"]');
    await input.fill("The edited consumer's description");
    await input.press("Enter");
    await expect.poll(() => zone.textContent(), SETTLE).toContain("The edited consumer's description");
    // The row's removal's affordance (the consumer's clear's stand — the
    // empty's commit's report over the callback):
    // the notSet's placeholder over the cleared store.
    await panel(a, "a")
      .locator(
        '[data-slot="docblocks/attribute-row"][data-attribute-key="description"] [data-slot="docblocks/attribute-row-remove"]'
      )
      .click();
    await expect.poll(() => zone.textContent(), SETTLE).toContain("Not set");
    // The document's stand: the description is never document data over the
    // prop's presence (the record stands no `description` — the consumer's
    // store is the source).
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.description), SETTLE).toBeUndefined();
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
