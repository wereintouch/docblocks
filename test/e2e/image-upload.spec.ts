import { type Browser, type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, editorContext } from "./helpers";

const FIXTURE = new URL("./fixtures/upload-test.png", import.meta.url).pathname;

/**
 * The slash Image upload (the blob bridge): the "Image"
 * command opens the file picker over the open menu, the upload resolves
 * against the consumer's blob store before any doc write, and one transact
 * commits the phrase-only block's replacement by the image (or the phrase
 * strip + insert after a non-empty block), with a trailing empty paragraph
 * when the image takes the sequence's end.
 * The doc holds only the committed key: the bytes are a consumer-side
 * concern, so the other pane (its own page, its own default in-memory
 * store) syncs the key and renders the placeholder when its store does not
 * know it.
 */

async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await editorContext(browser);
  const contextB = await editorContext(browser);
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

/** The pane's first image block's src attr (null when no image block stands). */
async function imageSrcInDoc(page: Page, client: "a" | "b"): Promise<string | null> {
  return page.evaluate((c) => {
    const d = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (d === null) return null;
    const blocks = d.toJSON().blocks;
    const image = Object.values(blocks).find((block) => block.type === "image");
    return image === undefined ? null : (image as unknown as { attrs: { src: string } }).attrs.src;
  }, client);
}

/** Pick the "Image" slash command and deliver the fixture file to the picker. */
async function uploadFixture(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "File" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE);
}

test("the slash File upload replaces the phrase-only block and adds one trailing paragraph", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux-img-s1");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/file");
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible();
  await uploadFixture(a);

  // The menu closes; the phrase-only caret block is replaced by the image,
  // and a trailing empty paragraph seats the caret. No empty block remains
  // before the attachment.
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toHaveCount(0);
  await expect
    .poll(
      () =>
        a.evaluate(() => {
          const doc = window.__paneDocs?.a;
          return doc?.getChildren(doc.meta.id).map((id) => doc.getBlock(id)?.type) ?? [];
        }),
      SETTLE
    )
    .toEqual(["image", "paragraph"]);
  const img = a.locator("img[data-slot='docblocks/image']");
  await expect(img).toBeVisible();
  const src = (await img.getAttribute("src")) ?? "";
  expect(src.startsWith("blob:")).toBe(true);
  expect(await img.getAttribute("data-subtype")).toBe("image");
  await expect(target).toHaveText("");

  // The doc holds only the committed key (the bytes stand in the store):
  // the key ≠ the displayable url the <img> renders.
  const srcInDoc = await imageSrcInDoc(a, "a");
  expect(srcInDoc).not.toBeNull();
  expect(srcInDoc).not.toBe(src);
  expect(src.startsWith("blob:")).toBe(true);

  // One undo step (the phrase strip + the insert stand in one transact):
  // the image and the trailing paragraph drop, the phrase comes back.
  await a.keyboard.press("Control+z");
  await expect(a.locator("img[data-slot='docblocks/image']")).toHaveCount(0);
  await expect(target).toHaveText("/file");
  await close();
});

test("the key syncs over the wire; the other pane's store renders the placeholder (the bytes are consumer-side)", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux-img-s2");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/file");
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible();
  await uploadFixture(a);
  await expect(a.locator("img[data-slot='docblocks/image']")).toBeVisible();
  const keyInDoc = await imageSrcInDoc(a, "a");

  // The key travels as plain doc data; pane B's own default store does not
  // hold the bytes (the per-page consumer boundary), so it renders the
  // placeholder for the same key. B converges over the wire — wait for the
  // key to stand (a one-shot read can catch B mid-convergence).
  await expect.poll(async () => imageSrcInDoc(b, "b"), SETTLE).toBe(keyInDoc);
  await expect(b.locator("img[data-slot='docblocks/image']")).toHaveCount(0);
  await expect(b.locator('[data-slot="docblocks/image-placeholder"]')).toBeVisible();
  await close();
});

test("a cancelled picker clears the stand over the page's focus (the doc stands untouched)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux-img-s3");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/file");
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible();

  // The File's pick closes the menu; the phrase's row stands the skeleton
  // (the picker's stand). The unhandled chooser is auto-cancelled by the
  // test runner — the dialog's close stands the page's focus (dispatched
  // explicitly: the headless runner's auto-cancel stands no focus event of
  // its own), and the stand clears over it.
  await a.locator('[data-slot="docblocks/slash-item"]', { hasText: "File" }).click();
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toHaveCount(0);
  await expect(a.locator('[data-slot="docblocks/file-upload-skeleton"]')).toBeVisible();
  await expect(a.locator('[data-slot="docblocks/file-upload-skeleton"]')).toHaveAttribute("data-state", "picker");
  await expect(a.locator("img[data-slot='docblocks/image']")).toHaveCount(0);

  await a.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(a.locator('[data-slot="docblocks/file-upload-skeleton"]')).toHaveCount(0);
  await expect(a.locator("img[data-slot='docblocks/image']")).toHaveCount(0);
  await expect(target).toHaveText("/file");
  await close();
});
