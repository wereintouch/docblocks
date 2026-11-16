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
    // The input's font stands the value column's size (the placeholder's
    // stand over the row's values' parity — the `text-xs`'s smaller
    // stand dropped).
    expect(await input.evaluate((el) => window.getComputedStyle(el).fontSize)).toBe("14px");
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
