import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

/** Insert one harness type at the root through the pane's insert control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
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

/** The pane's canvas container (inside the pane's doc root). */
const canvas = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas"]`);

/** The canvas-item wrappers' block ids in DOM order (the z-order). */
async function canvasItemOrder(page: Page, client: "a" | "b"): Promise<string[]> {
  return page
    .locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"]`)
    .evaluateAll((els) => els.map((el) => el.dataset.blockId as string));
}

/** The surface id + its children order, from the pane's live doc. */
async function surfaceInfo(page: Page, client: "a" | "b"): Promise<{ surfaceId: string; children: string[] }> {
  return page.evaluate(
    ({ client }) => {
      const doc = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      const json = doc?.toJSON();
      if (!json) return { surfaceId: "", children: [] };
      const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "surface");
      if (surfaceId === undefined) return { surfaceId: "", children: [] };
      const block = json.blocks[surfaceId]!;
      return { surfaceId, children: block.type === "surface" ? block.children! : [] };
    },
    { client }
  );
}

test("inserting a canvas in A renders the scene in both panes (shapes, the frame content, the connector, the JSON)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext05-scene");

  await insertType(a, "a", "canvas");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const c = canvas(pane, client);
    await expect(c).toHaveCount(1);
    // The four seeded shapes render as SVGs.
    await expect.poll(async () => c.locator('[data-slot="docblocks/shape"]').count(), SETTLE).toBe(4);
    // The frame's nested content renders inside the surface.
    await expect(c.getByText("Frame heading")).toBeVisible();
    await expect(c.getByText("Frame paragraph on the canvas.")).toBeVisible();
    // The connector line is present (both endpoints resolve within the surface).
    await expect(c.locator('[data-slot="docblocks/connector-layer"] path[data-connector-id]')).toHaveCount(1);
    // The DOM order of the wrappers is the scene's z-order (the seed order).
    const order = await canvasItemOrder(pane, client);
    expect(order.length).toBe(7);
  }

  // The JSON inspector shows a geometry object…
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"geometry"'), SETTLE).toBe(true);

  // …and the surface's children in the JSON are the z-order the DOM shows.
  const { children } = await surfaceInfo(a, "a");
  expect(await canvasItemOrder(a, "a")).toEqual(children);
  expect(await canvasItemOrder(b, "b")).toEqual(children);

  await close();
});

test("an edit inside the frame (the same-doc nested provider) reaches the other pane; the root JSON gains nothing", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext05-frame-edit");

  await insertType(a, "a", "canvas");
  await expect(canvas(a, "a").getByText("Frame paragraph on the canvas.")).toBeVisible();

  // The surface's children BEFORE the edit (the frame's children ids are
  // already there — the edit must not change the surface's children).
  const before = await surfaceInfo(a, "a");

  // Click into the frame's paragraph inside pane A's surface to focus its
  // editable, and park the caret at the end (a synthetic End keypress does
  // not move a contenteditable caret in headless Chromium, so the caret is
  // placed through the Selection API explicitly). The keystrokes then
  // commit to the PANE's doc (the frame's children are ordinary blocks of
  // the pane's doc) through the usual input path.
  const editable = canvas(a, "a").locator(
    '[data-slot="docblocks/frame"] [data-block-type="paragraph"] [data-slot="docblocks/block-content"]'
  );
  await editable.click();
  await editable.evaluate((el) => {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await a.keyboard.type(" edited");

  // Pane B's frame shows the edit (the same doc over the wire).
  await expect(canvas(b, "b").getByText("Frame paragraph on the canvas. edited")).toBeVisible();

  // The outer root's JSON gains nothing new: the surface's children are
  // unchanged (the frame's children ids were already there; the text changed).
  const after = await surfaceInfo(a, "a");
  expect(after.children).toEqual(before.children);
  // …while the frame's paragraph content in the JSON carries the edit.
  const editedInJson = await a.evaluate(() => {
    const json = window.__paneDocs?.a?.toJSON();
    if (!json) return false;
    return Object.values(json.blocks).some(
      (block) => block.type === "paragraph" && (block.content ?? []).some((run) => run.text.includes("edited"))
    );
  });
  expect(editedInJson).toBe(true);

  await close();
});

test("a moveBlock to the front of the surface's children reorders pane B's DOM (the z-order over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext05-zorder");

  await insertType(a, "a", "canvas");
  await expect(canvas(b, "b").locator('[data-slot="docblocks/shape"]')).toHaveCount(4);

  const { surfaceId, children } = await surfaceInfo(a, "a");
  // The seeded order: [frame, rect, ellipse, diamond, line, canvas-text,
  // connector] — move the rect (index 1) to the front.
  const rectId = children[1]!;
  await a.evaluate(
    ({ surfaceId, rectId }) => {
      window.__paneDocs?.a?.moveBlock(rectId, surfaceId, 0);
    },
    { surfaceId, rectId }
  );

  // Pane B's DOM order of the surface's children wrappers changes: the
  // moved wrapper is first.
  await expect.poll(async () => (await canvasItemOrder(b, "b"))[0], SETTLE).toBe(rectId);
  // …and pane B's JSON children order matches (the moved block first, the
  // former first block second, the rest in place).
  const bAfter = await surfaceInfo(b, "b");
  expect(bAfter.children).toEqual([rectId, children[0]!, ...children.slice(2)]);

  await close();
});

test("a setGeometry on a shape updates pane B's wrapper position (the geometry sync)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext05-geometry");

  await insertType(a, "a", "canvas");
  await expect(canvas(b, "b").locator('[data-slot="docblocks/shape"]')).toHaveCount(4);

  const { children } = await surfaceInfo(a, "a");
  const rectId = children[1]!;

  // A new center position on pane A's doc.
  await a.evaluate((rectId) => {
    window.__paneDocs?.a?.setGeometry(rectId, { x: -50, y: 20 });
  }, rectId);

  // Pane B's wrapper style updates: the computed left/top resolve to the
  // canvas center + the new x/y (tolerating sub-pixel rounding).
  await expect
    .poll(async () => {
      const info = await b.evaluate(
        ({ rectId }) => {
          const c = document.querySelector('[data-testid="doc-b"] [data-slot="docblocks/canvas"]');
          const el = c?.querySelector<HTMLElement>(`[data-slot="docblocks/canvas-item"][data-block-id="${rectId}"]`);
          if (c === null || el === undefined || c === undefined) return null;
          return {
            left: parseFloat(getComputedStyle(el!).left),
            top: parseFloat(getComputedStyle(el!).top),
            expectedLeft: c.clientWidth / 2 - 50,
            expectedTop: c.clientHeight / 2 + 20,
          };
        },
        { rectId }
      );
      if (info === null) return 99;
      return Math.max(Math.abs(info.left - info.expectedLeft), Math.abs(info.top - info.expectedTop));
    })
    .toBeLessThan(1.5);

  await close();
});
