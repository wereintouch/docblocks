import { type Page, expect, test } from "@playwright/test";
import { Buffer } from "node:buffer";

import { SETTLE, caretIn, editorContext, openPane } from "./helpers";

async function uploadTextAttachment(page: Page): Promise<void> {
  const target = page.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await target.click();
  await page.keyboard.type("/file");
  await expect(page.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible(SETTLE);
  expect(await page.locator('[data-slot="docblocks/slash-file-input"]').getAttribute("accept")).toBeNull();

  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "File" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("attachment body", "utf8"),
  });
  await expect(page.locator('[data-slot="docblocks/image-file"][data-subtype="file"]')).toBeVisible(SETTLE);
}

async function rootBlockIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = window.__paneDocs?.a;
    if (doc == null) return [];
    return doc.getChildren(doc.meta.id);
  });
}

test("a generic attachment uploads with its file name, renames, and downloads in read-only mode", async ({
  browser,
}) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  await openPane(page, "a", "file-attachment");
  try {
    await uploadTextAttachment(page);

    const card = page.locator('[data-testid="doc-a"] [data-slot="docblocks/image-file"][data-subtype="file"]');
    await expect(card.locator('[data-slot="docblocks/file-name"]')).toHaveText("notes.txt");
    await expect(card.locator('[data-slot="docblocks/file-icon"]')).toBeVisible();
    await expect(card.locator('[data-slot="docblocks/file-download"]')).toHaveAttribute("download", "notes.txt");
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const doc = window.__paneDocs?.a;
            const block = Object.values(doc?.toJSON().blocks ?? {}).find((entry) => entry.type === "image");
            return block?.attrs && "name" in block.attrs ? block.attrs.name : null;
          }),
        SETTLE
      )
      .toBe("notes.txt");

    await card.locator('[data-slot="docblocks/file-rename"]').click();
    const input = card.locator('[data-slot="docblocks/file-name-input"]');
    await input.fill("renamed-notes.txt");
    await input.press("Enter");
    await expect(card.locator('[data-slot="docblocks/file-name"]')).toHaveText("renamed-notes.txt");
    await expect(card.locator('[data-slot="docblocks/file-download"]')).toHaveAttribute(
      "download",
      "renamed-notes.txt"
    );

    const editedDownloadPromise = page.waitForEvent("download");
    await card.locator('[data-slot="docblocks/file-download"]').click();
    const editedDownload = await editedDownloadPromise;
    expect(editedDownload.suggestedFilename()).toBe("renamed-notes.txt");

    await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="View mode"]').click();
    await expect(page.locator('[data-testid="doc-a"] [data-slot="docblocks/editor"]')).toHaveAttribute(
      "data-readonly",
      "true"
    );
    await expect(card.locator('[data-slot="docblocks/file-rename"]')).toHaveCount(0);
    const readonlyDownloadPromise = page.waitForEvent("download");
    await card.locator('[data-slot="docblocks/file-download"]').click();
    const readonlyDownload = await readonlyDownloadPromise;
    expect(readonlyDownload.suggestedFilename()).toBe("renamed-notes.txt");
  } finally {
    await context.close();
  }
});

test("deleting an attachment seats the caret in the next block and one undo restores it", async ({ browser }) => {
  const context = await editorContext(browser);
  const page = await context.newPage();
  await openPane(page, "a", "file-attachment-delete");
  try {
    await uploadTextAttachment(page);
    const [imageId, nextId] = await rootBlockIds(page);
    expect(imageId).toBeDefined();
    expect(nextId).toBeDefined();

    const row = page.locator(`[data-testid="doc-a"] [data-slot="docblocks/row"]:has([data-block-id="${imageId}"])`);
    await row.hover();
    await row.locator('[data-slot="docblocks/gutter-delete"]').click();
    await expect(page.locator(`[data-testid="doc-a"] [data-block-id="${imageId}"]`)).toHaveCount(0);
    await expect
      .poll(() => caretIn(page, `[data-block-id="${nextId}"][data-slot="docblocks/block-content"]`), SETTLE)
      .toBe(true);

    await page.keyboard.press("Control+z");
    await expect(page.locator(`[data-testid="doc-a"] [data-block-id="${imageId}"]`)).toBeVisible(SETTLE);
    expect(await rootBlockIds(page)).toEqual([imageId, nextId]);
  } finally {
    await context.close();
  }
});
