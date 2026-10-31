// The systematic keyboard-only pass (the audit's regression layer): the
// Tab's path over the app's chrome and the keyboard's actions on the
// landmarks (the title's edit + the commit over the wire, the view's
// switch). The editor's text content stands out of the pass (the Tab's
// gesture's contract — the focus stays in the text; the content's
// editing's stands pin in the block's specs). The component's keyboard's
// pins stand in the component's specs (the code header's controls —
// code-block, the table's handles + the seam — table-ux, the canvas's
// model — canvas-keyboard, the figure border's slider —
// canvas-shape-border).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** The active element's data-slot (null when none / no slot). */
const activeSlot = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset?.slot ?? null);

/** The active element's aria-label (null when none). */
const activeAriaLabel = (page: Page) =>
  page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("aria-label") ?? null);

/** The Tab's presses (the real keyboard — the programmatic focus's stand
 * is out; the shift's direction — the backward's stand over the editor's
 * content, where the Tab's gesture owns the key) until the active
 * element stands the predicate. */
async function tabUntil(
  page: Page,
  what: string,
  predicate: () => Promise<boolean>,
  options: { backward?: boolean; max?: number } = {}
): Promise<void> {
  const { backward = false, max = 60 } = options;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(backward ? "Shift+Tab" : "Tab");
    if (await predicate()) return;
  }
  throw new Error(`the "${what}" is not in the Tab's path (the ${max} presses' stand)`);
}

test("the keyboard-only pass: the Tab's path, the title's edit (the wire's parity), the view's switch", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "a11y-kbd-pass");
  try {
    // The seed: the title + one text block (the doc's stand).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      doc!.setTitle("Kbd before");
      const p = doc!.insertBlock("paragraph");
      doc!.insertText(p, 0, "seed");
    });
    await expect.poll(async () => b.evaluate(() => window.__paneDocs?.b?.meta.title), SETTLE).toBe("Kbd before");

    // The title's landmark: the Tab's path reaches the title's button, the
    // Enter opens the edit (the focus's stand), the typing + the Enter
    // commit (the wire reaches B).
    await tabUntil(a, "the title's button", async () => (await activeSlot(a)) === "docblocks/doc-header-title");
    await a.keyboard.press("Enter");
    const edit = a.locator('[data-slot="docblocks/doc-header-title-edit"]');
    await expect(edit).toBeFocused();
    await a.keyboard.type(" after");
    await a.keyboard.press("Enter");
    await expect.poll(async () => b.evaluate(() => window.__paneDocs?.b?.meta.title), SETTLE).toBe("Kbd before after");

    // The view's switch's landmark: the backward's Tab stands the canvas's
    // button (the forward's path crosses the editor's content, where the
    // Tab's gesture owns the key — the focus stays in the text). The
    // Enter switches the view (the canvas's stand).
    await tabUntil(a, "the canvas's view's button", async () => (await activeAriaLabel(a)) === "Canvas view", {
      backward: true,
    });
    await a.keyboard.press("Enter");
    await expect(a.locator('[data-slot="docblocks/canvas-view"]')).toBeVisible();
  } finally {
    await close();
  }
});
