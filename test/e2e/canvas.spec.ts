// The canvas scene's sync (the surface + its elements stand in the data and
// render in the canvas view; the page view filters the surface out of the
// sequence, so the scene's DOM stands in the canvas view only). Over the
// reworked frame (the viewport window): the frame stands no nested content
// of its own — the frame's window renders the surface's layer as inert
// clipped copies (the copies' stand is the render only — the layer is
// pointer-transparent, the interaction stands on the originals), and the
// direct canvas-item wrappers' DOM order stands the z-order (the window's
// copies stand inside the frame's item, outside the order's read).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, canvasView, insertBlockType, switchPaneView, toCanvas, twoPanes } from "./helpers";

/** Insert one harness type at the root through the pane's insert control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/** The pane's scene container (the canvas view's world). */
const canvas = (page: Page, client: "a" | "b") =>
  canvasView(page, client).locator('[data-slot="docblocks/canvas-world"]');

/** The DIRECT canvas-item wrappers' block ids in DOM order (the z-order — the window's copies stand inside the frame's item and stand excluded). */
async function canvasItemOrder(page: Page, client: "a" | "b"): Promise<string[]> {
  return page.evaluate(
    ({ client }) => {
      const root = document.querySelector(`[data-testid="doc-${client}"]`);
      const items = Array.from(root?.querySelectorAll<HTMLElement>('[data-slot="docblocks/canvas-item"]') ?? []);
      return items
        .filter((el) => el.closest('[data-slot="docblocks/frame-window-content"]') === null)
        .map((el) => el.dataset.blockId as string);
    },
    { client }
  );
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

/** A surface child's id by its block stand (the frame's title, the shape's variant) over the pane's live doc. */
async function childByStand(
  page: Page,
  client: "a" | "b",
  stand: { type: string; title?: string; variant?: string }
): Promise<string | null> {
  return page.evaluate(
    ({ client, stand }) => {
      const doc = client === "a" ? window.__paneDocs?.a : window.__paneDocs?.b;
      const json = doc?.toJSON();
      if (!json) return null;
      const surfaceId = Object.keys(json.blocks).find((id) => json.blocks[id]!.type === "surface");
      if (surfaceId === undefined) return null;
      const surface = json.blocks[surfaceId]!;
      for (const id of surface.children ?? []) {
        const block = json.blocks[id]!;
        if (block.type !== stand.type) continue;
        if (stand.title !== undefined && block.attrs?.title !== stand.title) continue;
        if (stand.variant !== undefined && block.attrs?.variant !== stand.variant) continue;
        return id;
      }
      return null;
    },
    { client, stand }
  );
}

/**
 * The DIRECT canvas-item stand for a block id (the window's copies render
 * the same block id inside the frames' items — the stand's read takes the
 * wrapper outside any window's content): the item's text content + the
 * rendered rect (nulls when the direct wrapper is absent or unrendered).
 */
async function directItemStand(
  page: Page,
  client: "a" | "b",
  id: string
): Promise<{ text: string | null; width: number; height: number }> {
  return page.evaluate(
    ({ client, id }) => {
      const items = Array.from(
        document.querySelectorAll<HTMLElement>(
          `[data-testid="doc-${client}"] [data-slot="docblocks/canvas-item"][data-block-id="${id}"]`
        )
      );
      const direct = items.find((el) => el.closest('[data-slot="docblocks/frame-window-content"]') === null);
      if (direct === undefined || direct === null) return { text: null, width: 0, height: 0 };
      const rect = direct.getBoundingClientRect();
      return { text: direct.textContent ?? "", width: rect.width, height: rect.height };
    },
    { client, id }
  );
}

test("inserting a canvas in A renders the scene in both panes (the shapes, the frames' windows over the layer, the connector, the JSON)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext05-scene");
  try {
    await insertType(a, "a", "canvas");
    await toCanvas(a, "a");
    await toCanvas(b, "b");

    for (const [pane, client] of [
      [a, "a"],
      [b, "b"],
    ] as const) {
      const c = canvas(pane, client);
      await expect(c).toHaveCount(1);
      // The four seeded shapes render as SVGs (the DIRECT wrappers' stand —
      // the window's copies' renders stand inside the frames' items, out
      // of the order's read).
      const directShapes = await pane.evaluate(
        () =>
          Array.from(document.querySelectorAll<HTMLElement>('[data-slot="docblocks/shape"]')).filter(
            (el) => el.closest('[data-slot="docblocks/frame-window-content"]') === null
          ).length
      );
      await expect.poll(async () => directShapes, SETTLE).toBe(4);
      // The frames' titles stand (the chip over the window box — the
      // DIRECT items' chips; the window's copies' chips stand inside the
      // other frame's item).
      const frameA = await childByStand(pane, client, { type: "frame", title: "Frame A" });
      const frameB = await childByStand(pane, client, { type: "frame", title: "Frame B" });
      expect(frameA).not.toBeNull();
      expect(frameB).not.toBeNull();
      await expect
        .poll(
          async () => (await directItemStand(pane, client, frameA as string)).text?.includes("Frame A") ?? false,
          SETTLE
        )
        .toBe(true);
      await expect
        .poll(
          async () => (await directItemStand(pane, client, frameB as string)).text?.includes("Frame B") ?? false,
          SETTLE
        )
        .toBe(true);
      // The originals stand (the note's direct wrapper over the layer —
      // the frame is a region marker, no content copy).
      const note = await childByStand(pane, client, { type: "canvas-text" });
      expect(note).not.toBeNull();
      await expect
        .poll(async () => {
          const stand = await directItemStand(pane, client, note as string);
          return stand.width > 0 && stand.height > 0 && stand.text?.includes("Canvas note") === true;
        }, SETTLE)
        .toBe(true);
      // The connector line is present (both endpoints resolve within the
      // surface — the DIRECT layer's stand; the window's copies' lines
      // stand inside the frames' items).
      const directConnectors = await pane.evaluate(
        () =>
          Array.from(
            document.querySelectorAll<SVGPathElement>('[data-slot="docblocks/connector-layer"] path[data-connector-id]')
          ).filter((el) => el.closest('[data-slot="docblocks/frame-window-content"]') === null).length
      );
      await expect.poll(async () => directConnectors, SETTLE).toBe(1);
      // The DOM order of the direct wrappers is the scene's z-order (the
      // seed order: frame A, frame B, the shapes, the note, the connector).
      const order = await canvasItemOrder(pane, client);
      expect(order.length).toBe(8);
    }

    // The page view carries no surface (the scene is a canvas layer — the
    // surface is filtered out of the page sequence).
    await switchPaneView(a, "a", "page");
    await expect(a.locator('[data-slot="docblocks/canvas-item"]')).toHaveCount(0);
    await switchPaneView(a, "a", "canvas");

    // The JSON inspector shows a geometry object…
    const jsonA = a.getByTestId("json-a");
    await expect.poll(async () => (await jsonA.innerText()).includes('"geometry"'), SETTLE).toBe(true);

    // …and the surface's children in the JSON are the z-order the DOM shows.
    const { children } = await surfaceInfo(a, "a");
    expect(await canvasItemOrder(a, "a")).toEqual(children);
    expect(await canvasItemOrder(b, "b")).toEqual(children);
  } finally {
    await close();
  }
});

test("a moveBlock to the front of the surface's children reorders pane B's DOM (the z-order over the wire; the frames' view-back stand)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext05-zorder");
  try {
    await insertType(a, "a", "canvas");
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    const rectId = await childByStand(a, "a", { type: "shape", variant: "rect" });
    const frameA = await childByStand(a, "a", { type: "frame", title: "Frame A" });
    const frameB = await childByStand(a, "a", { type: "frame", title: "Frame B" });
    expect(rectId).not.toBeNull();
    // The scene's sync to pane B (the direct order carries the rect).
    await expect.poll(async () => (await canvasItemOrder(b, "b")).includes(rectId!), SETTLE).toBe(true);

    // The seeded order stands the frames first — the rect (the variant's
    // stand) moves to the front.
    const { surfaceId } = await surfaceInfo(a, "a");
    await a.evaluate(
      ({ surfaceId, rectId }) => {
        if (rectId === null) return;
        window.__paneDocs?.a?.moveBlock(rectId, surfaceId, 0);
      },
      { surfaceId, rectId }
    );

    // The frames' view-back stand: the frames (the window's parity — they
    // render behind every figure) stand first in the DOM over the data
    // order's stand; the figures' DOM order follows the data's z-order —
    // the moved rect leads them.
    await expect
      .poll(async () => {
        const order = await canvasItemOrder(b, "b");
        const figures = order.filter((id) => id !== frameA && id !== frameB);
        return figures[0];
      }, SETTLE)
      .toBe(rectId);
    // The frames' DOM's stand over the figures (the view-back's paint's
    // stand — the data's children order's stand stands the frames' slot
    // only).
    const bDom = await canvasItemOrder(b, "b");
    const figuresOnly = bDom.filter((id) => id !== frameA && id !== frameB);
    expect(figuresOnly.indexOf(rectId!)).toBe(0);
    // …and pane B's JSON children order matches (the moved block first,
    // the rest shifted by one).
    const bAfter = await surfaceInfo(b, "b");
    const aBefore = await surfaceInfo(a, "a");
    expect(bAfter.children).toEqual([rectId, ...aBefore.children.filter((id) => id !== rectId)]);
  } finally {
    await close();
  }
});

test("a setGeometry on a shape updates pane B's wrapper position (the geometry sync)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext05-geometry");
  try {
    await insertType(a, "a", "canvas");
    await toCanvas(a, "a");
    await toCanvas(b, "b");
    const rectId = await childByStand(a, "a", { type: "shape", variant: "rect" });
    expect(rectId).not.toBeNull();
    await expect
      .poll(async () => {
        const order = await canvasItemOrder(b, "b");
        return order.includes(rectId!);
      }, SETTLE)
      .toBe(true);

    // A new center position on pane A's doc.
    await a.evaluate((rectId) => {
      window.__paneDocs?.a?.setGeometry(rectId, { x: -50, y: 20 });
    }, rectId!);

    // Pane B's wrapper style updates: the computed left/top resolve to the
    // scene's center + the new x/y (the world is the 100%-sized stand — the
    // zoom / pan transform is on the world itself, so the item's own left /
    // top are unaffected; tolerating sub-pixel rounding). The stand's read
    // excludes the window's copies (they render the same block id over the
    // window's zero-sized anchor).
    await expect
      .poll(async () => {
        const info = await b.evaluate(
          ({ rectId }) => {
            const items = Array.from(
              document.querySelectorAll<HTMLElement>(
                `[data-testid="doc-b"] [data-slot="docblocks/canvas-item"][data-block-id="${rectId}"]`
              )
            );
            const world = document.querySelector('[data-testid="doc-b"] [data-slot="docblocks/canvas-world"]');
            const el = items.find(
              (candidate) => candidate.closest('[data-slot="docblocks/frame-window-content"]') === null
            );
            if (world === null || world === undefined || el === null || el === undefined) return null;
            return {
              left: parseFloat(getComputedStyle(el).left),
              top: parseFloat(getComputedStyle(el).top),
              expectedLeft: world.clientWidth / 2 - 50,
              expectedTop: world.clientHeight / 2 + 20,
            };
          },
          { rectId }
        );
        if (info === null) return 99;
        return Math.max(Math.abs(info.left - info.expectedLeft), Math.abs(info.top - info.expectedTop));
      })
      .toBeLessThan(1.5);
  } finally {
    await close();
  }
});
