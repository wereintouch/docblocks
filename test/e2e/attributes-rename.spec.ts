// The document-attributes panel — the custom key's rename over the key's
// click: the value's form's keep, the order's position's keep (the entry's
// replacement over the stored order), the wire over both panes, the invalid
// target's open stand, and the undo's restore (one command).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

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

test("the custom key's rename over the key's click (the value's form's keep, the order's position, the wire over both, the invalid target's open stand, the undo's restore)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-rename");
  try {
    // The consumer's seed (the typed forms + the stored order's stand).
    await a.evaluate(() => {
      const d = window.__paneDocs?.a ?? null;
      if (d === null) throw new Error("pane A's doc is not mounted");
      d.setAttribute("note", { type: "string", value: "hello" });
      d.setAttribute("count", { type: "number", value: 3 });
      d.reorderAttributes(["note", "count"]);
    });
    await openPanel(a, "a");
    // The key's entry (the click's stand over the custom row).
    const keyBtn = panel(a, "a").locator('[data-slot="docblocks/attribute-key"][data-attribute-key="note"]');
    await expect(keyBtn).toBeVisible();
    // The band's height's parity (the key's hover band stands the value's
    // band's height — the one height's stand over the panel's rows;
    // the side inset over the glyphs stands the parity too).
    const bands = await panel(a, "a")
      .locator('[data-slot="docblocks/attribute-row"][data-attribute-key="note"]')
      .evaluate((row) => {
        const key = row.querySelector<HTMLElement>("[data-slot='docblocks/attribute-key']");
        const value = row.querySelector<HTMLElement>("[data-slot='docblocks/attribute-custom']");
        if (key === null || value === null) return null;
        return {
          keyH: key.getBoundingClientRect().height,
          valueH: value.getBoundingClientRect().height,
          keyInset: parseFloat(getComputedStyle(key).paddingLeft),
          valueInset: parseFloat(getComputedStyle(value.querySelector("span") as HTMLElement).paddingLeft),
        };
      });
    if (bands === null) throw new Error("the note's bands have no box");
    expect(Math.abs(bands.keyH - bands.valueH), "the key's band should stand the value's band's height").toBeLessThan(
      1
    );
    expect(bands.keyInset, "the key's band inset should stand the value's band inset").toBeCloseTo(bands.valueInset, 1);
    await keyBtn.click();
    const rename = panel(a, "a").locator('[data-slot="docblocks/attribute-note-rename"]');
    await expect(rename).toBeVisible();
    // The select-all's stand (the replace's parity over the mount).
    const sel = await rename.evaluate((el) => {
      const input = el as HTMLInputElement;
      return { start: input.selectionStart, end: input.selectionEnd, len: input.value.length };
    });
    expect(sel).toEqual({ start: 0, end: 4, len: 4 });
    // The frame's stand: the text stands the label column's edge (the
    // display's parity over the key's button), the input's box (the
    // border / the selection's frame) stands the edge's left (the
    // frame's no-glue over the text's left).
    const frame = await rename.evaluate((el) => {
      const input = el as HTMLInputElement;
      const r = input.getBoundingClientRect();
      const labelCol = (el as HTMLElement)
        .closest<HTMLElement>("[data-slot='docblocks/attribute-row']")
        ?.children[0]?.getBoundingClientRect();
      if (labelCol === undefined || labelCol === null) return null;
      return {
        textLeft: r.left + parseFloat(getComputedStyle(input).paddingLeft),
        frameLeft: r.left,
        colLeft: labelCol.left,
      };
    });
    if (frame === null) throw new Error("the rename's frame has no column's box");
    expect(Math.abs(frame.textLeft - frame.colLeft), "the rename's text should stand the column's edge").toBeLessThan(
      0.5
    );
    expect(frame.colLeft - frame.frameLeft, "the frame should stand the text's edge's left").toBeGreaterThanOrEqual(2);
    // The invalid target's stand (the taken's key — the no-write's open
    // stand over the invalid's border).
    await rename.fill("count");
    await rename.press("Enter");
    await expect(rename, "the input should stay open over the invalid target").toBeVisible();
    await expect(rename).toHaveAttribute("aria-invalid", "true");
    expect(await attributesOf(a, "a")).toEqual({
      note: { type: "string", value: "hello" },
      count: { type: "number", value: 3 },
    });
    // The valid rename's commit (the value's form's keep — the typed
    // wrapper's parity; the key's row's re-render over the new key).
    await rename.fill("remark");
    await rename.press("Enter");
    await expect(rename).toHaveCount(0);
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.remark), SETTLE)
      .toEqual({
        type: "string",
        value: "hello",
      });
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE).toBeUndefined();
    // The order's position's keep (the entry's replacement over the
    // stored order — the JSON's field over the wire).
    await expect.poll(() => attrOrderOf(a, "a"), SETTLE).toEqual(["remark", "count"]);
    await expect
      .poll(() => jsonOf(a, "a").then((json) => JSON.parse(json).attributesOrder as string[] | undefined), SETTLE)
      .toEqual(["remark", "count"]);
    // The wire over both panes (the display + the data over the sync).
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.remark), SETTLE)
      .toEqual({
        type: "string",
        value: "hello",
      });
    await expect.poll(() => attrOrderOf(b, "b"), SETTLE).toEqual(["remark", "count"]);
    await openPanel(b, "b");
    await expect(
      panel(b, "b").locator('[data-slot="docblocks/attribute-row"][data-attribute-key="remark"]')
    ).toBeVisible();
    // The rename is A's local undo entry (one command): the undo restores
    // the old key over the value's keep + the order's entry.
    await a.evaluate(() => {
      const d = window.__paneDocs?.a ?? null;
      if (d === null) throw new Error("pane A's doc is not mounted");
      d.undo();
    });
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.note), SETTLE)
      .toEqual({
        type: "string",
        value: "hello",
      });
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.remark), SETTLE).toBeUndefined();
    await expect.poll(() => attrOrderOf(a, "a"), SETTLE).toEqual(["note", "count"]);
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.note), SETTLE)
      .toEqual({
        type: "string",
        value: "hello",
      });
  } finally {
    await close();
  }
});
