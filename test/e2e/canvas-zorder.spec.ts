import { type Browser, type Page, expect, test } from "@playwright/test";

import { switchPaneView } from "./helpers";

// The canvas z-order (the 2026-10-22 explicit zIndex): the dense `zIndex`
// (1..N over the surface's canvas elements — 1 = bottom) stands the paint
// order (the children order's mirror). The three-dots menu over the shape /
// connector toolbars reorders via `setZOrder` (one transact — one undo step,
// one wire update); the edge states stand disabled; the new figure lands on
// top (max + 1). The paint stand is the DOM order (the connector's line
// stands inside its own wrapper, so a reorder moves the real line over /
// under the figures).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
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

async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

/** The surface + the three shapes (rect / ellipse / rect), disjoint boxes. */
async function seedShapes(page: Page, client: "a" | "b"): Promise<{ surface: string; ids: [string, string, string] }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane doc is missing");
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      const b = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
      const c = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -120, y: 0, w: 80, h: 60 });
      doc.setGeometry(b, { x: 0, y: 0, w: 80, h: 60 });
      doc.setGeometry(c, { x: 120, y: 0, w: 80, h: 60 });
      return { surface, ids: [a, b, c] };
    },
    { client }
  );
}

/** The surface + the two shapes + the connector (the topmost child). */
async function seedConnectorScene(
  page: Page,
  client: "a" | "b"
): Promise<{ surface: string; a: string; b: string; connector: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane doc is missing");
      const surface = doc.insertBlock("surface");
      const a = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      const b = doc.insertBlock("shape", { variant: "rect" }, { parent: surface });
      doc.setGeometry(a, { x: -120, y: 0, w: 80, h: 60 });
      doc.setGeometry(b, { x: 120, y: 0, w: 80, h: 60 });
      const connector = doc.insertBlock(
        "connector",
        { start: { blockId: a }, end: { blockId: b } },
        { parent: surface }
      );
      return { surface, a, b, connector };
    },
    { client }
  );
}

/** The surface's children order (the z-order's storage). */
async function surfaceOrder(page: Page, client: "a" | "b", surface: string): Promise<string[]> {
  return page.evaluate(
    ({ client, surface }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane doc is missing");
      return doc.getChildren(surface);
    },
    { client, surface }
  );
}

/** The block's `zIndex` stand (null when absent). */
async function zIndexOf(page: Page, client: "a" | "b", id: string): Promise<number | null> {
  return page.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane doc is missing");
      return (doc.getBlock(id)?.attrs?.zIndex as number | undefined) ?? null;
    },
    { client, id }
  );
}

/** The canvas-item wrappers in DOM order (the paint order's stand). */
async function paintOrder(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
      if (view === null) throw new Error("the canvas view is missing");
      return Array.from(view.querySelectorAll<HTMLElement>("[data-slot='docblocks/canvas-item']")).map(
        (el) => el.dataset.blockId as string
      );
    },
    { client }
  );
}

/** Select the block by a press on its wrapper / hit path (the real pointer). */
async function selectItem(page: Page, id: string, viaHitPath = false): Promise<void> {
  const selector = viaHitPath
    ? `[data-connector-id="${id}"]`
    : `[data-slot="docblocks/canvas-item"][data-block-id="${id}"]`;
  const box = (await page.locator(`[data-testid="doc-a"] ${selector}`).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect
    .poll(
      async () =>
        (await page.evaluate(
          ({ client, id }) => {
            const view = document.querySelector(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);
            if (view === null) return null;
            return (
              view.querySelector<HTMLElement>(
                `[data-slot="docblocks/canvas-item"][data-selected][data-block-id="${id}"]`
              ) !== null
            );
          },
          { client: "a", id }
        )) === true,
      SETTLE
    )
    .toBe(true);
}

/** The z-order menu's item disabled state (the Radix stand: data-disabled). */
async function itemDisabled(page: Page, name: string): Promise<boolean> {
  const el = page.getByRole("menuitem", { name });
  return el.evaluate((node) => node.hasAttribute("data-disabled") || node.getAttribute("aria-disabled") === "true");
}

/** Pick a menu item by its label (the menu is open). */
async function pickItem(page: Page, name: string): Promise<void> {
  await page.getByRole("menuitem", { name }).click();
}

test("the shape toolbar's arrange menu: the picks, the wire, the undo", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "canvas-zorder");
  try {
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    const { surface, ids } = await seedShapes(a, "a");
    const [bottom, middle, top] = ids;

    // The dense indices stand (1 = bottom). The other pane sees the seed.
    await expect.poll(async () => await surfaceOrder(b, "b", surface), SETTLE).toEqual(ids);
    expect(await zIndexOf(a, "a", bottom)).toBe(1);
    expect(await zIndexOf(a, "a", middle)).toBe(2);
    expect(await zIndexOf(a, "a", top)).toBe(3);

    // The middle shape: the menu stands, no edge is disabled.
    await selectItem(a, middle);
    const trigger = a.getByLabel("Arrange shape");
    await expect(trigger).toBeVisible();
    await trigger.click();
    expect(await itemDisabled(a, "Bring forward")).toBe(false);
    expect(await itemDisabled(a, "Bring to front")).toBe(false);
    expect(await itemDisabled(a, "Send backward")).toBe(false);
    expect(await itemDisabled(a, "Send to back")).toBe(false);

    // "Bring forward": the adjacent swap (middle over top) — one transact.
    await pickItem(a, "Bring forward");
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual([bottom, top, middle]);
    expect(await zIndexOf(a, "a", middle)).toBe(3);
    expect(await zIndexOf(a, "a", top)).toBe(2);

    // The wire: the other pane's order + indices stand.
    await expect.poll(async () => await surfaceOrder(b, "b", surface), SETTLE).toEqual([bottom, top, middle]);
    expect(await zIndexOf(b, "b", middle)).toBe(3);
    expect(await zIndexOf(b, "b", top)).toBe(2);
    expect(await zIndexOf(b, "b", bottom)).toBe(1);

    // The one undo step restores the order + the indices (the focus stands
    // on the canvas view — the portaled menu's press dropped it off).
    await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
    await a.keyboard.press("Control+z");
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual(ids);
    expect(await zIndexOf(a, "a", middle)).toBe(2);
    await expect.poll(async () => await surfaceOrder(b, "b", surface), SETTLE).toEqual(ids);
  } finally {
    await close();
  }
});

test("the edge states stand disabled (the bottommost / the topmost)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "canvas-zorder-edges");
  try {
    await toCanvas(a, "a");
    const { ids } = await seedShapes(a, "a");
    const [bottom, , top] = ids;

    // The bottommost: the backward / back picks are disabled, the
    // forward / front picks stand.
    await selectItem(a, bottom);
    await a.getByLabel("Arrange shape").click();
    expect(await itemDisabled(a, "Send backward")).toBe(true);
    expect(await itemDisabled(a, "Send to back")).toBe(true);
    expect(await itemDisabled(a, "Bring forward")).toBe(false);
    expect(await itemDisabled(a, "Bring to front")).toBe(false);
    await a.keyboard.press("Escape");
    await expect(a.getByRole("menuitem", { name: "Bring forward" })).toHaveCount(0);

    // The topmost: the forward / front picks are disabled, the backward /
    // back picks stand.
    await selectItem(a, top);
    await a.getByLabel("Arrange shape").click();
    expect(await itemDisabled(a, "Bring forward")).toBe(true);
    expect(await itemDisabled(a, "Bring to front")).toBe(true);
    expect(await itemDisabled(a, "Send backward")).toBe(false);
    expect(await itemDisabled(a, "Send to back")).toBe(false);
  } finally {
    await close();
  }
});

test("the connector's 'send to back' stands the line under the figures (the paint order over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "canvas-zorder-connector");
  try {
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    const { surface, a: aId, b: bId, connector } = await seedConnectorScene(a, "a");

    // The new connector stands on top (max + 1): the paint order's tail.
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual([aId, bId, connector]);
    expect(await zIndexOf(a, "a", connector)).toBe(3);
    expect(await paintOrder(a, "a")).toEqual([aId, bId, connector]);

    // The menu over the selected line: "send to back" — the line stands
    // under both figures.
    await selectItem(a, connector, true);
    await a.getByLabel("Arrange line").click();
    await pickItem(a, "Send to back");
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual([connector, aId, bId]);
    expect(await zIndexOf(a, "a", connector)).toBe(1);
    expect(await zIndexOf(a, "a", aId)).toBe(2);
    expect(await zIndexOf(a, "a", bId)).toBe(3);

    // The paint order follows (the per-line wrapper reorders with the
    // children — the line stands below the shapes), and the line stands
    // still (the reorder is the z, not the geometry).
    expect(await paintOrder(a, "a")).toEqual([connector, aId, bId]);
    const line = a.locator(`[data-connector-id="${connector}"]`);
    await expect(line).toHaveCount(1);

    // The wire: the other pane's order / indices / paint stand.
    await expect.poll(async () => await surfaceOrder(b, "b", surface), SETTLE).toEqual([connector, aId, bId]);
    expect(await zIndexOf(b, "b", connector)).toBe(1);
    expect(await paintOrder(b, "b")).toEqual([connector, aId, bId]);

    // The undo restores the order (one step — the reorder is one transact).
    await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').focus();
    await a.keyboard.press("Control+z");
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual([aId, bId, connector]);
    expect(await zIndexOf(a, "a", connector)).toBe(3);
    expect(await paintOrder(a, "a")).toEqual([aId, bId, connector]);
  } finally {
    await close();
  }
});

test("a new figure stands on top (max + 1)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "canvas-zorder-new");
  try {
    await toCanvas(a, "a");
    const { surface, ids } = await seedShapes(a, "a");
    const [a1, b1, c1] = ids;

    // The new shape (the doc command): max + 1 — the paint order's tail.
    const created = await a.evaluate(
      ({ surface }) => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane doc is missing");
        return doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
      },
      { surface }
    );
    await expect.poll(async () => await surfaceOrder(a, "a", surface), SETTLE).toEqual([a1, b1, c1, created]);
    expect(await zIndexOf(a, "a", created)).toBe(4);
    expect(await paintOrder(a, "a")).toEqual([a1, b1, c1, created]);
  } finally {
    await close();
  }
});

test("the draw's press over an existing line's band stands the free stand (the line is not a stand target)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "canvas-zorder-drawband");
  try {
    await toCanvas(a, "a");
    const { connector } = await seedConnectorScene(a, "a");
    const dock = a
      .locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]')
      .getByRole("toolbar", { name: "Canvas tools" });
    await dock.getByLabel("Connector").click();

    // The line's midpoint (the band's press point — the empty canvas between
    // the shapes: no port in reach, no shape under the band). The press-drag
    // over the band: the stand stands the FREE press point (the connector
    // carries no box — the line's own band is no stand target), and the
    // release on the empty canvas commits the free second endpoint.
    const viewBox = (await a.locator('[data-testid="doc-a"] [data-slot="docblocks/canvas-view"]').boundingBox())!;
    const cx = viewBox.x + viewBox.width / 2;
    const cy = viewBox.y + viewBox.height / 2;
    await a.mouse.move(cx, cy);
    await a.mouse.down();
    await a.mouse.move(cx, cy + 150, { steps: 10 });
    await a.mouse.up();

    // The committed connector: the free endpoints (the press point + the
    // release point) — NOT a ref to the existing line (its box is phantom).
    const state = await a.evaluate(
      ({ old }) => {
        const doc = window.__paneDocs?.a ?? null;
        if (doc === null) throw new Error("the pane doc is missing");
        const json = doc.toJSON();
        const createdId = Object.entries(json.blocks)
          .filter(([, block]) => block.type === "connector")
          .map(([id]) => id)
          .find((id) => id !== old);
        const created = createdId !== undefined ? json.blocks[createdId] : null;
        return { attrs: created?.attrs ?? null };
      },
      { old: connector }
    );
    expect(state.attrs).not.toBeNull();
    expect(state.attrs?.start).toEqual({ x: 0, y: 0 });
    expect(state.attrs?.end).toEqual({ x: 0, y: 150 });
  } finally {
    await close();
  }
});
