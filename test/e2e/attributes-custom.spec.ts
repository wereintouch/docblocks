// The document-attributes panel — the custom attributes: the typed add
// over the popover's flow (the type's pick + the name's draft + the commit
// over the typed initial form), the value's edit over the row's zone (the
// typed form's write-back — the type stands kept over the new value), and
// the row's removal (the wire over both panes).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

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
