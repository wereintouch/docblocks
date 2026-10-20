import { type Browser, type Page, expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };
const FIXTURE = new URL("./fixtures/upload-test.png", import.meta.url).pathname;

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`).first()).toHaveText("connected");
}

async function twoPanes(browser: Browser, room: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom);
  await openPane(b, "b", uniqueRoom);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** The pane's image block's attrs from the harness global (its own letter). */
async function imageAttrs(page: Page, client: "a" | "b"): Promise<Record<string, unknown> | null> {
  return page.evaluate((c) => {
    const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
    if (doc === null || doc === undefined) return null;
    const json = doc.toJSON();
    const block = Object.values(json.blocks).find((entry) => entry.type === "image");
    return block?.attrs ?? null;
  }, client);
}

/** Pick the slash Image and deliver the fixture (the upload path). */
async function uploadFixture(page: Page): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator('[data-slot="docblocks/slash-item"]', { hasText: "Image" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(FIXTURE);
}

/** The pane's image block's id from the harness global (its own letter). */
async function imageBlockId(page: Page, client: "a" | "b"): Promise<string | null> {
  return page.evaluate((c) => {
    const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
    if (doc === null || doc === undefined) return null;
    const json = doc.toJSON();
    const entry = Object.entries(json.blocks).find(([, block]) => block.type === "image");
    return entry?.[0] ?? null;
  }, client);
}

/** The block's type in the pane's live doc (null while the pane is unmounted). */
async function blockTypeInDoc(page: Page, client: "a" | "b", id: string): Promise<string | null> {
  return page.evaluate(
    ([c, blockId]) => {
      const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      if (doc === null || doc === undefined) return null;
      return doc.getBlock(blockId)?.type ?? null;
    },
    [client, id] as const
  );
}

/** The block's text (paragraphs only; null otherwise or while unmounted). */
async function paragraphTextInDoc(page: Page, client: "a" | "b", id: string): Promise<string | null> {
  return page.evaluate(
    ([c, blockId]) => {
      const doc = c === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      if (doc === null || doc === undefined) return null;
      return doc.getBlock(blockId)?.type === "paragraph" ? doc.getText(blockId) : null;
    },
    [client, id] as const
  );
}

test("the delete key over the selected image converts it to an empty paragraph (the caret seats there, over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "img-ux");

  const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await target.click();
  await a.keyboard.type("/image");
  await expect(a.locator('[data-slot="docblocks/slash-menu"]').first()).toBeVisible(SETTLE);
  await uploadFixture(a);

  const img = a.locator('img[data-slot="docblocks/image"]');
  await expect(img).toBeVisible(SETTLE);
  const figure = a.locator('[data-slot="docblocks/image-figure"]');
  const imageId = (await imageBlockId(a, "a"))!;

  // The wire: pane B's doc carries the image (B's own store holds no
  // blob, so B's figure stands the placeholder card — the slot is the pin).
  await expect(b.locator('[data-slot="docblocks/image-placeholder"]')).toHaveCount(1, SETTLE);

  // The click selects the figure; the Delete converts it in place (the
  // block id stands — the type flips to paragraph, the image's attrs drop).
  await img.click();
  await expect(figure).toHaveAttribute("data-selected", "true", SETTLE);
  await a.keyboard.press("Delete");

  await expect(a.locator('[data-slot="docblocks/image-figure"]')).toHaveCount(0, SETTLE);
  // Pane B's store holds no blob (the upload was pane A's): B's image
  // stands the placeholder card — the slot is the wire pin.
  await expect(b.locator('[data-slot="docblocks/image-placeholder"]')).toHaveCount(0, SETTLE);
  await expect.poll(async () => blockTypeInDoc(a, "a", imageId), SETTLE).toBe("paragraph");
  await expect.poll(async () => blockTypeInDoc(b, "b", imageId), SETTLE).toBe("paragraph");

  // The caret seats in the survivor's inner (the converted paragraph).
  await expect
    .poll(
      async () =>
        a.evaluate((id) => {
          const inner = document.querySelector<HTMLElement>(
            `[data-block-id="${id}"][data-slot="docblocks/block-content"]`
          );
          return inner !== null && document.activeElement === inner;
        }, imageId),
      SETTLE
    )
    .toBe(true);

  // Typing now edits the paragraph (the image is gone from the data).
  await a.keyboard.insertText("caption text");
  await expect.poll(async () => paragraphTextInDoc(a, "a", imageId), SETTLE).toBe("caption text");

  // The undos revert in order (the typing, then the conversion — the
  // image stands back on both panes, the attrs travel with it). Pane B's
  // own store holds no blob: the placeholder card stands there.
  await a.keyboard.press("Control+z");
  await a.keyboard.press("Control+z");
  await expect(a.locator('img[data-slot="docblocks/image"]')).toBeVisible(SETTLE);
  await expect(b.locator('[data-slot="docblocks/image-placeholder"]')).toHaveCount(1, SETTLE);

  await close();
});

test("the image figure: the click's selection ring, the port resize, and the hover menu (over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "img-ux");

  const target = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await target.click();
  await a.keyboard.type("/image");
  await expect(a.locator('[data-slot="docblocks/slash-menu"]')).toBeVisible(SETTLE);
  await uploadFixture(a);

  const img = a.locator('img[data-slot="docblocks/image"]');
  await expect(img).toBeVisible(SETTLE);
  const figure = a.locator('[data-slot="docblocks/image-figure"]');
  await expect(figure).toBeVisible(SETTLE);

  // --- The click's selection: the canvas token's ring + the four corner ports.
  await img.click();
  await expect(figure).toHaveAttribute("data-selected", "true", SETTLE);
  const [ring, token] = await figure.evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement("div");
    probe.style.color = cs.getPropertyValue("--docblocks-canvas-selection-border-color").trim();
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return [cs.outlineColor, resolved];
  });
  expect(ring).toBe(token);
  await expect(a.locator('[data-slot="docblocks/image-port"]')).toHaveCount(4, SETTLE);

  // --- The port resize (the NE corner: the bottom ports can stand below
  //     the fold on a tall image): the in-flight preview is view state, the
  //     release commits the width (the aspect ratio stands — the height
  //     follows), and the editor's content width is the upper bound.
  await figure.scrollIntoViewIfNeeded();
  const box = (await figure.boundingBox())!;
  await a.mouse.move(box.x + box.width, box.y);
  await a.mouse.down();
  await a.mouse.move(box.x + box.width * 0.6, box.y, { steps: 5 });
  await a.mouse.up();

  const attrsA = await imageAttrs(a, "a");
  expect(attrsA).not.toBeNull();
  expect(typeof attrsA!.width).toBe("number");
  expect(attrsA!.width).toBeGreaterThan(0);
  expect(attrsA!.width).toBeLessThan(box.width);
  // The wire: pane B's doc carries the same width (the data only).
  await expect.poll(async () => (await imageAttrs(b, "b"))!.width, SETTLE).toBe(attrsA!.width);

  // The undo reverts the width (the absent attr stood before the drag).
  await a.keyboard.press("Control+z");
  await expect.poll(async () => (await imageAttrs(a, "a"))!.width, SETTLE).toBeUndefined();

  // --- The hover menu (top-right over the figure): the download, the caption,
  //     the align controls.
  await img.hover();
  const menu = a.locator('[data-slot="docblocks/image-menu"]');
  await expect.poll(async () => await menu.evaluate((el) => getComputedStyle(el).opacity), SETTLE).toBe("1");

  const download = menu.locator('[data-slot="docblocks/image-download"]');
  await expect(download).toHaveAttribute("href", /^data:image\//);
  await expect(download).toHaveAttribute("download", "upload-test.png");

  // The caption (the code block's caption idiom): the button stands the line,
  // the commit travels over the wire.
  await menu.locator('[data-slot="docblocks/image-caption-toggle"]').click();
  const caption = a.locator('[data-slot="docblocks/image-caption"]');
  await expect(caption).toBeVisible(SETTLE);
  await caption.fill("Fig 1");
  await expect.poll(async () => (await imageAttrs(a, "a"))!.caption, SETTLE).toBe("Fig 1");
  await expect.poll(async () => (await imageAttrs(b, "b"))!.caption, SETTLE).toBe("Fig 1");

  // The align: the center pick stands the placement (the JSON on both panes).
  await menu.locator('[data-slot="docblocks/image-align"][data-align="center"]').click();
  await expect(figure).toHaveAttribute("data-align", "center", SETTLE);
  await expect.poll(async () => (await imageAttrs(b, "b"))!.align, SETTLE).toBe("center");

  await close();
});
