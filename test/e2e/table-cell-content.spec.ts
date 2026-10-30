// The cell's own content layer (the v1 text-cell shape: a table-cell may
// carry its own runs in addition to its children blocks): the runs render
// as an editable layer at the top of the cell in both panes, and the input
// commits to the cell's own content over the wire (one undo step).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** Seed a 1-column table whose single cell carries its own runs. */
async function seedOwnContentCell(page: Page, client: "a" | "b"): Promise<{ cellId: string }> {
  return page.evaluate(
    ({ c }) => {
      const doc = window.__paneDocs?.[c];
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      let cellId = "";
      doc.transact(() => {
        const tableId = doc.insertBlock("table", { cols: 1 });
        const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
        cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
        doc.insertText(cellId, 0, "own runs");
      });
      return { cellId };
    },
    { c: client }
  );
}

const cellLayer = (page: Page, cellId: string) =>
  page.locator(`td[data-block-id="${cellId}"] [data-slot="docblocks/block-content"]`);

test("the cell's own runs render as a layer in both panes (the wire carries the content)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux-tcc-render");
  const { cellId } = await seedOwnContentCell(a, "a");

  // The layer stands in both panes (the cell's runs — no child paragraph).
  await expect.poll(() => cellLayer(a, cellId).count(), SETTLE).toBe(1);
  await expect(cellLayer(a, cellId)).toHaveText("own runs");
  await expect.poll(() => cellLayer(b, cellId).count(), SETTLE).toBe(1);
  await expect(cellLayer(b, cellId)).toHaveText("own runs");
  // The cell carries runs: its own activation layer is absent.
  await expect(a.locator(`td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`)).toHaveCount(0);
  await expect(b.locator(`td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`)).toHaveCount(0);
  // The pane's doc carries the cell's own content (not a child block).
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getText(id) ?? "", cellId), SETTLE)
    .toBe("own runs");
  await expect
    .poll(async () => b.evaluate((id) => window.__paneDocs?.b?.getText(id) ?? "", cellId), SETTLE)
    .toBe("own runs");

  await close();
});

test("typing in the cell's own layer reaches the other pane (the undo reverts)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ux-tcc-input");
  const { cellId } = await seedOwnContentCell(a, "a");
  await expect.poll(() => cellLayer(a, cellId).count(), SETTLE).toBe(1);

  // Type at the end of the layer's text (the real keyboard path).
  await cellLayer(a, cellId).click();
  await a.keyboard.press("End");
  await a.keyboard.type("!");

  // The other pane's cell text carries the character (the wire update).
  await expect
    .poll(async () => b.evaluate((id) => window.__paneDocs?.b?.getText(id) ?? "", cellId), SETTLE)
    .toBe("own runs!");
  await expect(cellLayer(b, cellId)).toHaveText("own runs!");

  // The undo reverts the character in both panes.
  await a.keyboard.press("Control+z");
  await expect
    .poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getText(id) ?? "", cellId), SETTLE)
    .toBe("own runs");
  await expect
    .poll(async () => b.evaluate((id) => window.__paneDocs?.b?.getText(id) ?? "", cellId), SETTLE)
    .toBe("own runs");

  await close();
});

test("the last-character delete parks the focus on the activation layer (the undo reach)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ux-tcc-park");
  const { cellId } = await seedOwnContentCell(a, "a");
  await expect.poll(() => cellLayer(a, cellId).count(), SETTLE).toBe(1);

  // Delete the cell's whole own text: the layer unmounts with the cell
  // normalized to content: [] — the focus must park on the activation
  // layer (the undo hotkey reach), and Ctrl+Z must restore the text.
  await cellLayer(a, cellId).click();
  await a.keyboard.press("End");
  for (let i = 0; i < "own runs".length; i++) await a.keyboard.press("Backspace");
  await a.waitForFunction(
    (cellId) => {
      const activation = document.querySelector(
        `td[data-block-id="${cellId}"] [data-slot="docblocks/cell-activation"]`
      );
      return activation !== null && document.activeElement === activation;
    },
    cellId,
    SETTLE
  );
  await a.keyboard.press("Control+z");
  // Each backspace stood one undo step: the hotkey reached the editor root
  // and reverts the last one (the last character stands again).
  await expect.poll(async () => a.evaluate((id) => window.__paneDocs?.a?.getText(id) ?? "", cellId), SETTLE).toBe("o");
  await expect(cellLayer(a, cellId)).toHaveText("o");

  await close();
});
