// The published stand's selection policy (the consumer's per-reader stand):
// the default keeps the reader's selection and copy off (the `published`
// mode's own block — `published.spec.ts` pins the flow), the
// `publishedCopyable` prop lifts it — the page's text stands selectable and
// the editor's payload serves the copy (the `view` mode's parity).
import { type Page, expect, test } from "@playwright/test";

import {
  SETTLE,
  editorContext,
  grantClipboardPermissions,
  interceptClipboardWrites,
  openPane,
  readClipboardPayload,
} from "./helpers";

/** A mouse drag over the snapshot's two blocks (the cross-block range). */
async function dragOverBlocks(page: Page): Promise<void> {
  const rectOf = async (index: number) =>
    page
      .locator('[data-slot="docblocks/block-content"]')
      .nth(index)
      .evaluate((el) => {
        const node = Array.from(el.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
        if (node === undefined) throw new Error("the block should carry a text node");
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      });
  const first = await rectOf(0);
  const second = await rectOf(1);
  await page.mouse.move(first.left + 1, first.top + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.left + second.width - 1, second.top + second.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("the copyable published policy serves the reader's selection and copy (the consumer's per-reader stand)", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  await grantClipboardPermissions(context);
  const page = await context.newPage();
  await openPane(page, "a", "pub-copyable");
  try {
    // The editor's pane seeds the live text (two blocks — the cross-block
    // range stands the editor's payload) and publishes it (the room's
    // shared stand — the viewer's snapshot source).
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        for (const child of doc.getChildren(doc.toJSON().id)) doc.removeBlock(child);
        const first = doc.insertBlock("paragraph");
        doc.insertText(first, 0, "alpha");
        const second = doc.insertBlock("paragraph");
        doc.insertText(second, 0, "beta");
      });
    });
    await expect(page.locator('[data-slot="docblocks/page"]').first()).toContainText("beta", SETTLE);
    await page.getByTestId("publish-a").click();
    await interceptClipboardWrites(page);

    // The reader's stand without the policy: the default published block —
    // the text stands no selection (the drag reaches nothing).
    await openPane(page, "a", "pub-copyable", { role: "viewer" });
    const editorRoot = page.locator('[data-slot="docblocks/editor"]').first();
    await expect(editorRoot).toHaveAttribute("data-readonly", "true");
    await expect(editorRoot).not.toHaveAttribute("data-copyable");
    await expect(page.locator('[data-slot="docblocks/page"]').first()).toContainText("beta", SETTLE);
    expect(await editorRoot.evaluate((el) => getComputedStyle(el).userSelect)).toBe("none");
    await dragOverBlocks(page);
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");

    // The same snapshot over the consumer's copyable policy: the page's
    // text stands selectable (the native range over the non-editable
    // inners) and the editor's payload serves the copy.
    await openPane(page, "a", "pub-copyable", { role: "viewer", publishedCopyable: true });
    await interceptClipboardWrites(page);
    await expect(editorRoot).toHaveAttribute("data-copyable", "true");
    await expect(page.locator('[data-slot="docblocks/page"]').first()).toContainText("beta", SETTLE);
    expect(await editorRoot.evaluate((el) => getComputedStyle(el).userSelect)).not.toBe("none");
    await dragOverBlocks(page);
    await expect.poll(async () => page.evaluate(() => window.getSelection()?.toString() ?? "")).toContain("beta");
    await page.keyboard.press("Control+c");
    await expect
      .poll(async () => readClipboardPayload(page))
      .toEqual({
        html: "<div>alpha</div><div>beta</div>",
        plain: "alpha\nbeta",
      });
  } finally {
    await context.close();
  }
});
