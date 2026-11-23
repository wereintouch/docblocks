// The long text's cell's editor's stand (the Baserow's stand): the
// floating 6-row's box over the cell's top edge (the rows' no-shift,
// the covered rows' opaque), the Enter's break, the outside press's
// commit, the Escape's cancel.
import { expect, test } from "@playwright/test";

import { SETTLE, editorContext, openPane } from "./helpers";

test("the long text's cell: the double press stands the floating 6-row editor (the Baserow's stand: the box over the cell's top edge, the width = the cell's, the rows stand no shift, the covered rows' stand opaque; the Enter's break; the outside press's commit; the Escape's cancel)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const a = await context.newPage();
  try {
    await openPane(a, "a", "db-multiline-" + Math.random().toString(36).slice(2, 8));

    // A text table over the pane's own bridge.
    const { tableId, bodyColId, numColId } = await a.evaluate(async () => {
      const bridge = window.__bridge!;
      const ctx = () => ({ operationId: crypto.randomUUID(), issuedAt: new Date().toISOString() });
      const table = await bridge.createTable({ name: "MultiLine" }, ctx());
      const id = table.result.id;
      const bodyCol = await bridge.createColumn(
        id,
        { column: { name: "Body", type: "text", position: 0, nullable: true } },
        ctx()
      );
      const numCol = await bridge.createColumn(
        id,
        { column: { name: "Num", type: "integer", position: 1, nullable: true } },
        ctx()
      );
      await bridge.batchRows(
        id,
        {
          ops: [
            {
              op: "create",
              row: {
                [bodyCol.result.id]: "Line one\nline two\nline three\nline four\nline five\nline six\nline seven",
                [numCol.result.id]: 1,
              },
              beforeRowId: null,
            },
            { op: "create", row: { [bodyCol.result.id]: "Short", [numCol.result.id]: 2 }, beforeRowId: null },
          ],
        },
        ctx()
      );
      return { tableId: id, bodyColId: bodyCol.result.id, numColId: numCol.result.id };
    });
    await a.evaluate((id) => window.__paneDocs!.a!.insertBlock("database", { tableId: id }), tableId);
    // The pane's grid (the single database block).
    const gridA = a.locator("[data-slot='docblocks/database-grid']").first();
    await expect(gridA).toBeVisible(SETTLE);

    // The double press stands the editor OVER THE CELL (the Baserow's
    // stand — the portaled layer): the display drops (the duplication is
    // out), the box's top edge stands over the row's top edge, the box
    // stands the 6 rows' height over the next row (the row stands no
    // shift).
    const cell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='0']`);
    const restBox = (await cell.boundingBox())!;
    const nextRowBox = (await gridA
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`)
      .boundingBox())!;
    // The text's seat over the open (the no-jump's stand): the display's
    // text start (the box's left + the display's px-1) — measured before
    // the open (the display drops over the edit).
    const displaySeatLeft = await cell
      .locator("[data-slot='docblocks/database-cell-display']")
      .evaluate((el) => el.getBoundingClientRect().left + 4);
    await cell.dblclick();
    const textarea = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await expect(textarea).toBeVisible(SETTLE);
    expect(await cell.locator("[data-slot='docblocks/database-cell-display']").count()).toBe(0);
    // The enter animation's zoom scales the box during the settle window:
    // the seat's and geometry's measures wait for the transform to settle.
    const editorContent = a.locator(
      "[data-slot='popover-content']:has([data-slot='docblocks/database-cell-multiline'])"
    );
    await expect(editorContent).toHaveCSS("transform", "none");
    const metrics = await textarea.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      const lineHeight = parseFloat(getComputedStyle(ta).lineHeight);
      return {
        width: ta.offsetWidth,
        rows: ta.rows,
        height: ta.clientHeight,
        lineHeight,
        value: ta.value,
        scrollable: ta.scrollHeight > ta.clientHeight,
        focused: document.activeElement === ta,
        caretAtEnd: ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length,
        textStartLeft: ta.getBoundingClientRect().left + parseFloat(getComputedStyle(ta).paddingLeft),
      };
    });
    expect(metrics.rows).toBe(6);
    expect(metrics.height).toBeGreaterThanOrEqual(6 * metrics.lineHeight);
    expect(metrics.height).toBeLessThanOrEqual(6 * metrics.lineHeight + 24);
    expect(metrics.scrollable).toBe(true);
    // The caret stands the value's END (the autoFocus's start seat is out),
    // the editor holds the focus.
    expect(metrics.focused).toBe(true);
    expect(metrics.caretAtEnd).toBe(true);
    // The text's seat stands the display's (the padding compensates the
    // border's 1px over the cell's seat — the open's jump is out).
    expect(Math.abs(metrics.textStartLeft - displaySeatLeft)).toBeLessThanOrEqual(1);
    // The Baserow's geometry: the floating box's top edge stands a few px
    // OVER the cell's top edge (the box opens over the row's top), the
    // box's width stands the cell's (the box = the column's width), the
    // box's stand is opaque (the popover's background — the covered rows
    // stand none through it).
    const editorBox = (await editorContent.boundingBox())!;
    expect(editorBox.y).toBeLessThan(restBox.y);
    expect(restBox.y - editorBox.y).toBeLessThanOrEqual(14);
    expect(Math.abs(editorBox.x - restBox.x)).toBeLessThanOrEqual(2);
    expect(Math.abs(editorBox.width - restBox.width)).toBeLessThanOrEqual(4);
    const editorBg = await editorContent.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(editorBg).not.toBe("rgba(0, 0, 0, 0)");
    // The rows stand no shift (the fixed track — the box stands the
    // portaled layer over the grid, the layout never moves), and the box
    // COVERS the row below (the point over the next row hits the portaled
    // editor).
    const stillNextRowBox = (await gridA
      .locator(`[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`)
      .boundingBox())!;
    expect(stillNextRowBox.y).toBe(nextRowBox.y);
    const covered = await a.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return el instanceof Element && el.closest("[data-radix-popper-content-wrapper]") !== null;
      },
      { x: editorBox.x + editorBox.width / 2, y: nextRowBox.y + nextRowBox.height / 2 }
    );
    expect(covered).toBe(true);

    // The character's own editing (the grid's cell-clear gesture stands no
    // stand over the focused textarea — the guard's contract): the typed
    // character stands, the Backspace deletes the character only (the
    // cell's clear is out), the session stands.
    await a.keyboard.type("Z");
    let draftValue = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    expect(draftValue.endsWith("line sevenZ")).toBe(true);
    await a.keyboard.press("Backspace");
    draftValue = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value);
    expect(draftValue.endsWith("line sevenZ")).toBe(false);
    expect(draftValue.endsWith("line seven")).toBe(true);
    await expect(textarea).toBeVisible(SETTLE);

    // The Enter stands the soft break (the raw \n — the session stands
    // open, no commit).
    await a.keyboard.press("Enter");
    await a.keyboard.type("Appended");
    await expect(textarea).toBeVisible(SETTLE);
    const draftLines = await textarea.evaluate((el) => (el as HTMLTextAreaElement).value.split("\n").length);
    expect(draftLines).toBe(8);

    // The outside press (the real mouse): the session's teardown commits
    // the draft in one updateRow (the commit stands over the pane's
    // bridge).
    const box = await gridA.boundingBox();
    await a.mouse.click(box!.x - 40, box!.y + 10);
    await expect(textarea).toBeHidden(SETTLE);
    const committed = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[0]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(committed).toBe("Line one\nline two\nline three\nline four\nline five\nline six\nline seven\nAppended");

    // The Escape's cancel (the short cell): the typed draft stands no
    // write.
    const shortCell = gridA.locator(
      `[data-slot='docblocks/database-cell'][data-column-id='${bodyColId}'][data-row='1']`
    );
    const shortEditor = a.locator("[data-slot='docblocks/database-cell-multiline']");
    await shortCell.dblclick();
    await expect(shortEditor).toBeVisible(SETTLE);
    await a.keyboard.type("X");
    await a.keyboard.press("Escape");
    await expect(shortEditor).toBeHidden(SETTLE);
    const afterCancel = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[1]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(afterCancel).toBe("Short");

    // The short cell's commit stands the same session (the outside
    // press's teardown commits the draft; the caret stands the end — the
    // autoFocus's start seat is out).
    await shortCell.dblclick();
    await expect(shortEditor).toBeVisible(SETTLE);
    await shortEditor.evaluate((el) => {
      const ta = el as HTMLTextAreaElement;
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    await a.keyboard.type(" X");
    await a.mouse.click(box!.x - 40, box!.y + 10);
    await expect(shortEditor).toBeHidden(SETTLE);
    const afterCommit = await a.evaluate(
      async ({ id, columnId }) => {
        const page = await window.__bridge!.snapshotTable(id, {});
        return page.page.rows[1]?.cells[columnId] as string | undefined;
      },
      { id: tableId, columnId: bodyColId }
    );
    expect(afterCommit).toBe("Short X");

    // The regression: the number's cell stands the input (the textarea's
    // stand is the text's only).
    const numCell = gridA.locator(`[data-slot='docblocks/database-cell'][data-column-id='${numColId}'][data-row='0']`);
    await numCell.dblclick();
    const numInput = gridA.locator(
      `[data-slot='docblocks/database-cell'][data-column-id='${numColId}'][data-row='0'] input`
    );
    await expect(numInput).toBeVisible(SETTLE);
    expect(await a.locator("[data-slot='docblocks/database-cell-multiline']").count()).toBe(0);
  } finally {
    await context.close();
  }
});
