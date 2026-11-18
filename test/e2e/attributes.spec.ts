// The document-attributes panel over the editor page column (the consumer's
// own document metadata — the markdown frontmatter's stand): the
// collapsed-by-default stand (the session state — no doc write over the
// toggle), the system rows (id / created / the live last updated), the
// preset editors (description / the tags' consumer-owned chips (the
// `docTags`'s contract — the document's no-write's stand); the status
// stands display-only — the consumer's data) + the system rows (the locale's
// committing one `setAttribute` each and syncing over the wire to the
// second pane, the custom attributes (add / edit / remove), and the
// view-mode's display-only stand. The panel stands over the page's shared
// editable (a non-editable island), so the canvas view never renders it.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, switchPaneView, toCanvas, twoPanes } from "./helpers";

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
    // The boolean's checkbox's stand (the project's checkbox over the
    // value's zone — the toggle's flip over the typed form's keep, the
    // wire over both panes).
    await addAttribute("boolean", "flag");
    const flagCheckbox = panel(a, "a").locator(
      '[data-slot="docblocks/attribute-custom-boolean"][data-attribute-key="flag"]'
    );
    await expect(flagCheckbox).toHaveAttribute("aria-checked", "false");
    await flagCheckbox.click();
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.flag), SETTLE)
      .toEqual({ type: "boolean", value: true });
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.flag), SETTLE)
      .toEqual({ type: "boolean", value: true });
    // Pane B's display over the sync (the checked's stand).
    await openPanel(b, "b");
    await expect(
      panel(b, "b").locator('[data-slot="docblocks/attribute-custom-boolean"][data-attribute-key="flag"]')
    ).toHaveAttribute("aria-checked", "true");
    // The list's line editor (the vertical's stack — the add's flow's
    // initial form over the type: the empty's stand + the new line's input
    // over the stack's tail).
    await addAttribute("list", "todo");
    const listSlot = panel(a, "a").locator('[data-slot="docblocks/attribute-todo-list"]');
    const todoAdd = listSlot.locator('[data-slot="docblocks/attribute-todo-list-input"]');
    await expect(todoAdd).toBeVisible();
    // The first line's add (the Enter's commit).
    await todoAdd.fill("first");
    await todoAdd.press("Enter");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.todo), SETTLE)
      .toEqual({ type: "list", value: ["first"] });
    // The second line's add (the tail's input's stand — the "the second's
    // line"'s path).
    await todoAdd.fill("second");
    await todoAdd.press("Enter");
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.todo), SETTLE)
      .toEqual({ type: "list", value: ["first", "second"] });
    await expect
      .poll(() => attributesOf(b, "b").then((m) => m?.todo), SETTLE)
      .toEqual({ type: "list", value: ["first", "second"] });
    // The line's removal (the × over the line's right — the whole list's
    // commit over the wire).
    await listSlot.locator('[data-slot="docblocks/attribute-todo-list-line-remove"]').first().click();
    await expect
      .poll(() => attributesOf(a, "a").then((m) => m?.todo), SETTLE)
      .toEqual({ type: "list", value: ["second"] });
    // The list row's label stands opposite the FIRST line (the top-align's
    // stand — the row's center stand dropped).
    const listLabelMid = await body(a, "a")
      .locator('[data-slot="docblocks/attribute-row"][data-attribute-key="todo"]')
      .evaluate((row) => {
        const label = row.children[0]?.getBoundingClientRect();
        const firstLine = row
          .querySelector<HTMLElement>('[data-slot="docblocks/attribute-todo-list-line"]')
          ?.getBoundingClientRect();
        if (label === undefined || label === null || firstLine === undefined || firstLine === null) return null;
        return Math.abs(label.top + label.height / 2 - (firstLine.top + firstLine.height / 2));
      });
    expect(listLabelMid, "the list row's label should stand opposite the first line").toBeLessThan(1);
    // The grip's top align's stand over the list's row: the grip's
    // midline stands the key's (first line's) midline — the row's
    // center stand dropped over the stack's rows.
    const listGripMid = await body(a, "a")
      .locator('[data-slot="docblocks/attribute-row-grip"][data-attribute-key="todo"]')
      .evaluate((grip) => {
        const g = grip.getBoundingClientRect();
        const label = grip
          .closest<HTMLElement>("[data-slot='docblocks/attribute-custom-row']")
          ?.querySelector<HTMLElement>("[data-slot='docblocks/attribute-row']")
          ?.children[0]?.getBoundingClientRect();
        if (label === undefined || label === null) return null;
        return Math.abs(g.top + g.height / 2 - (label.top + label.height / 2));
      });
    expect(listGripMid, "the list row's grip should stand opposite the key").toBeLessThan(1);
    // The custom key's left edge stands the label column's edge (the
    // preset's keys' parity — the key's button's no-padding stand).
    // The text's stand (the button's padding's keep — the band's
    // inset over the text, the text's position over the column's edge).
    const keyLeftParity = await body(a, "a")
      .locator('[data-slot="docblocks/attribute-key"][data-attribute-key="todo"]')
      .evaluate((btn) => {
        const b = btn.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(btn).paddingLeft);
        const label = btn
          .closest<HTMLElement>("[data-slot='docblocks/attributes']")
          ?.querySelector<HTMLElement>("[data-slot='docblocks/attribute-row'][data-attribute-key='tags']")
          ?.children[0]?.getBoundingClientRect();
        if (label === undefined || label === null) return null;
        return Math.abs(b.left + pad - label.left);
      });
    expect(keyLeftParity, "the custom key should stand the label column's left edge").toBeLessThan(0.5);
    // The value's vertical stand (the label's midline's parity over the
    // value's midline — the page's line-height's no-stand) + the row's
    // height's uniform stand over the single value's types (the row's
    // `min-h`'s stand — the checkbox's row's shorter stand dropped).
    const heights: number[] = [];
    for (const key of ["revision", "note", "u7", "flag"]) {
      const measured = await body(a, "a")
        .locator(`[data-slot="docblocks/attribute-row"][data-attribute-key="${key}"]`)
        .evaluate((row) => {
          const label = row.children[0]?.getBoundingClientRect();
          const value = row.children[1]?.firstElementChild?.getBoundingClientRect();
          if (label === undefined || label === null || value === undefined || value === null) return null;
          return {
            off: Math.abs(label.top + label.height / 2 - (value.top + value.height / 2)),
            h: row.getBoundingClientRect().height,
          };
        });
      expect(measured, `the row "${key}" should stand its label and the value's zone`).not.toBeNull();
      expect(measured!.off, `the row "${key}"'s value should stand the label's midline`).toBeLessThan(1);
      heights.push(measured!.h);
    }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
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
    // The entry's animation's stand (the 100ms's zoom + the frame's settle).
    await a.waitForTimeout(250);
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
    await a.waitForTimeout(300);
    expect(await rows.nth(0).getAttribute("data-attribute-key")).toBe("alpha");
    expect(await rows.nth(1).getAttribute("data-attribute-key")).toBe("beta");
    expect(await attrOrderOf(a, "a")).toEqual(["alpha", "beta"]);
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

// The cover's upload's fixtures: the 1x1 pixel (the short / the narrow's
// gate's rejection), the 400x200 solid (the tile's accepted cover — the
// narrow strip's glue's stand), the 1600x400 solid (the wide cover — the
// editor width's minimum's stand over the 1280px's viewport), the
// 1600x100 solid (the centering's short cover — the scaled height's
// under-cap's stand), and the 1x1 GIF (the unsupported type's rejection).
const SHORT_PNG = new URL("./fixtures/upload-test.png", import.meta.url).pathname;
const TALL_PNG = new URL("./fixtures/cover-400x200.png", import.meta.url).pathname;
const WIDE_PNG = new URL("./fixtures/cover-1600x400.png", import.meta.url).pathname;
const SHORT_WIDE_PNG = new URL("./fixtures/cover-1600x100.png", import.meta.url).pathname;
const GIF = new URL("./fixtures/cover-1x1.gif", import.meta.url).pathname;
const coverBanner = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/cover-banner"]`);
const editorRoot = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/editor"]`);

/** The upload's modal's flow: the drop zone's click + the file's choice
 *  over the standard picker (the filechooser's stand). */
async function pickInModal(page: Page, file: string): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/cover-upload-dropzone"]').click();
  await (await chooser).setFiles(file);
}

test("the cover's upload modal: the gate over the mode, the banner over the top, the mode's row", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-modal");
  try {
    await openPanel(a, "a");
    const upload = panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]');
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');

    // The modal's open (the selector's stand, the tile's default).
    await upload.click();
    await expect(dialog).toBeVisible();
    await expect(a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="tile"]')).toHaveAttribute(
      "aria-pressed",
      "true"
    );

    // The short image over the tile (the height gate's rejection): the
    // upload never reaches the store, the doc stands the no write, the
    // hint's stand shows the threshold, and the modal keeps open.
    await pickInModal(a, SHORT_PNG);
    const hint = a.locator('[data-slot="docblocks/cover-upload-error"]');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/150/);
    expect((await attributesOf(a, "a"))?.cover, "the rejection stands the no write").toBeUndefined();
    await expect(dialog).toBeVisible();

    // The tall image over the tile's default — the acceptance's stand:
    // the modal's close, the cover's commit (the mode's absence — the
    // tile's stand), the banner's render over the editor frame's top
    // edge (the full frame width's bleed, the frame's corner's clip),
    // and the sync to pane B over the wire.
    await pickInModal(a, TALL_PNG);
    await expect(dialog).toBeHidden();
    const cover = (await attributesOf(a, "a"))?.cover;
    expect(cover, "the accepted image commits the cover").toBeTruthy();
    expect((await attributesOf(a, "a"))?.coverMode, "the tile's stand is the key's absence").toBeUndefined();
    const banner = coverBanner(a, "a");
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("data-cover-mode", "tile");
    // The frame's edge's stand: the banner stands the editor frame's full
    // width (not the page column's centered stand), and the frame's top
    // corner stands the card's radius's clip.
    const bannerBox = await banner.boundingBox();
    const editorBox = await editorRoot(a, "a").boundingBox();
    expect(bannerBox, "the banner should stand").not.toBeNull();
    expect(editorBox, "the editor should stand").not.toBeNull();
    expect(Math.abs(bannerBox!.width - editorBox!.width), "the full frame width's bleed").toBeLessThan(2);
    // The fixed's strip's height's stand (the image's 200px's natural
    // height scaled down to the 150px's constant).
    expect(Math.round(bannerBox!.height), "the fixed strip's height").toBe(150);
    // The frame's corner's clip: the banner's top radius stands the
    // card's radius (the card's computed stand — no magic number's
    // stand over the scale's change).
    const cardRadius = await editorRoot(a, "a").evaluate(
      (el) => getComputedStyle(el.parentElement as HTMLElement).borderTopLeftRadius
    );
    await expect(banner).toHaveCSS("border-top-left-radius", cardRadius);
    // The narrow strip's stand (the 400px's fixture over the frame's
    // width): the repeat-x's glue.
    await expect(banner.locator("div").first()).toHaveCSS("background-repeat", "repeat-x");
    // The banner stands above the attributes panel (the top's placement).
    const panelBox = await panel(a, "a").boundingBox();
    expect(panelBox, "the panel should stand").not.toBeNull();
    expect(bannerBox!.y, "the banner stands above the panel").toBeLessThan(panelBox!.y);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.cover ?? null), SETTLE).toBe(cover);
    // The banner's render over pane B stands the blob store's stand (the
    // harness's store is per-context — the cross-pane's blob's stand is
    // the consumer's, not the package's), so pane B's pin is the
    // attribute's sync only.

    // The mode's switch's gate (the narrow strip's stand): the centering's
    // option stands disabled over the current image (the width's gate's
    // unmet stand). The wide's re-upload stands the gate's met's stand —
    // the option's enabled stand over the same row.
    const centerOption = a.locator('[data-slot="docblocks/attributes-cover-mode"] [data-mode="center"]');
    await expect(centerOption).toBeDisabled();
    await upload.click();
    await expect(dialog).toBeVisible();
    await pickInModal(a, WIDE_PNG);
    await expect(dialog).toBeHidden();
    await expect(centerOption).toBeEnabled();

    // The mode's row's switch (the panel's toggle over the gate's met
    // stand): the centering's commit (the key's write) + the banner's
    // re-stand (the width scaled to the frame, the 150px's slice over the
    // scaled height's cap) — synced to pane B.
    await centerOption.click();
    await expect.poll(() => attributesOf(a, "a").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");
    await expect(banner).toHaveAttribute("data-cover-mode", "center");
    // The 1600x400's fixture scaled to the frame's width: the scaled
    // height exceeds the cap at the harness's width — the slice stands
    // the maximum.
    const centerBox = await banner.boundingBox();
    expect(centerBox, "the centering's banner should stand").not.toBeNull();
    expect(Math.round(centerBox!.height), "the centered slice's cap").toBe(150);
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");

    // The canvas view never renders the banner (the page view's stand).
    await switchPaneView(a, "a", "canvas");
    await expect(coverBanner(a, "a")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the cover's upload modal: the centering's width gate + the unsupported type's rejection", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "doc-attributes-cover-center");
  try {
    await openPanel(a, "a");
    await panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]').click();
    const dialog = a.locator('[data-slot="docblocks/cover-upload-dialog"]');

    // The centering's mode (the modal's selector): the editor width's
    // minimum's gate over the image's width.
    await a.locator('[data-slot="docblocks/cover-upload-mode"] [data-mode="center"]').click();

    // The narrow image (the 400px's fixture over the editor frame's
    // width) — the width gate's rejection: the no upload's no write, the
    // hint's stand over the measured width.
    await pickInModal(a, TALL_PNG);
    const hint = a.locator('[data-slot="docblocks/cover-upload-error"]');
    await expect(hint).toBeVisible();
    expect((await attributesOf(a, "a"))?.cover, "the rejection stands the no write").toBeUndefined();
    await expect(dialog).toBeVisible();

    // The GIF — the MIME's gate's rejection (the decode's no probe).
    await pickInModal(a, GIF);
    await expect(hint).toBeVisible();
    await expect(hint).not.toHaveText(/150/);
    expect((await attributesOf(a, "a"))?.cover, "the unsupported type stands the no write").toBeUndefined();

    // The wide image — the acceptance's stand over the centering: the
    // cover + the mode's commit (the key's write), the banner's
    // centering's stand (the scaled height's cap), and the sync to pane B.
    await pickInModal(a, WIDE_PNG);
    await expect(dialog).toBeHidden();
    const cover = (await attributesOf(a, "a"))?.cover;
    expect(cover, "the accepted image commits the cover").toBeTruthy();
    expect((await attributesOf(a, "a"))?.coverMode, "the centering commits the key").toBe("center");
    const banner = coverBanner(a, "a");
    await expect(banner).toHaveAttribute("data-cover-mode", "center");
    // The sliced height over the scaled width (the cap's stand at the
    // harness's frame's width).
    const frameWidth = (await editorRoot(a, "a").boundingBox())!.width;
    const wideBox = await banner.boundingBox();
    expect(Math.round(wideBox!.height), "the capped slice's height").toBe(
      Math.round(Math.min(150, (400 * frameWidth) / 1600))
    );
    await expect.poll(() => attributesOf(b, "b").then((m) => m?.coverMode ?? null), SETTLE).toBe("center");

    // The short wide image — the scaled height's under-cap's stand: the
    // slice stands the scaled height's own (under the 150px's cap).
    await panel(a, "a").locator('[data-slot="docblocks/attributes-cover-upload-button"]').click();
    await expect(dialog).toBeVisible();
    await pickInModal(a, SHORT_WIDE_PNG);
    await expect(dialog).toBeHidden();
    const shortBox = await banner.boundingBox();
    expect(Math.round(shortBox!.height), "the under-cap slice's height").toBe(
      Math.round(Math.min(150, (100 * frameWidth) / 1600))
    );
  } finally {
    await close();
  }
});
