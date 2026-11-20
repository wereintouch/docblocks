// The view mode's copy stand (the access's contract): the read-only live
// document keeps its text selectable — the native range over the
// non-editable inners — and the editor's copy payload serves it (the same
// serialization as the edit mode's). The published stand keeps the ban
// (`published.spec.ts` pins it); the canvas world keeps the no-select
// stand (`view-mode.spec.ts` pins it).
import { type Browser, type Page, expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

/** Switch the pane's mode to the view's mode and pin the read-only's stand. */
async function toViewMode(page: Page): Promise<void> {
  await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
  await expect(page.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
}

test("the view mode's text stands selectable and copyable (the table copies as the spreadsheet's grid)", async ({
  browser,
}: {
  browser: Browser;
}) => {
  const context = await editorContext(browser);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  await openPane(page, "a", "vm-copy");
  try {
    // The seed: a paragraph, a 2×2 table (its cells' texts), and the tail.
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        for (const child of doc.getChildren(doc.toJSON().id)) doc.removeBlock(child);
        const before = doc.insertBlock("paragraph");
        doc.insertText(before, 0, "before");
        const tableId = doc.insertBlock("table", { cols: 2, columnWidths: [100, 100] });
        for (let row = 0; row < 2; row += 1) {
          const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
          for (let col = 0; col < 2; col += 1) {
            const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
            const paragraph = doc.insertBlock("paragraph", undefined, { parent: cellId });
            doc.insertText(paragraph, 0, `r${row}c${col}`);
          }
        }
        const after = doc.insertBlock("paragraph");
        doc.insertText(after, 0, "after");
      });
    });
    await toViewMode(page);
    const pageColumn = page.locator('[data-slot="docblocks/page"]').first();
    // The read-only's copy stand: the native selection stands over the
    // view's mode (the published's stand keeps the ban).
    expect(await pageColumn.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
    // A mouse drag over the paragraph's text selects it.
    const firstInner = page.locator('[data-slot="docblocks/block-content"]').first();
    const textRect = await firstInner.evaluate((el) => {
      const node = Array.from(el.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
      if (node === undefined) throw new Error("the block should carry a text node");
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    await page.mouse.move(textRect.left + 1, textRect.top + textRect.height / 2);
    await page.mouse.down();
    await page.mouse.move(textRect.left + textRect.width - 1, textRect.top + textRect.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("before");
    // The whole-document's select-all + copy: the table stands the grid
    // over both flavors (the html table for the spreadsheet's paste, the
    // TSV over the plain text).
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+c");
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const items = await navigator.clipboard.read();
          const textOf = async (type: string) => {
            const matching = items.filter((item) => item.types.includes(type));
            return matching[0] === undefined ? null : await matching[0].getType(type).then((blob) => blob.text());
          };
          const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
          return { html, plain };
        })
      )
      .toEqual({
        html: "<div>before</div><table><tbody><tr><td>r0c0</td><td>r0c1</td></tr><tr><td>r1c0</td><td>r1c1</td></tr></tbody></table><div>after</div>",
        plain: "before\nr0c0\tr0c1\nr1c0\tr1c1\nafter",
      });
  } finally {
    await context.close();
  }
});
