// The embed's view state: the toolbar zoom's persist over the wire, the wheel's zoom/pan,
// the modifier drag-pan, and the persisted view's restore over the reload.
import { type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

test("the embed's toolbar zoom persists over the doc's attrs (the panes share the persisted view)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "embed-panzoom");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');
  const iframeB = b.locator(
    '[data-testid="doc-b"] [data-block-type="embed"]:not([data-slot="docblocks/row"]) iframe[data-slot="docblocks/embed"]'
  );
  await expect(iframe).toHaveAttribute("style", /scale\(1\)/);

  // The persisted view's read over the block's attrs (the null idiom: the
  // identity's zoom stands `null` / absent).
  const zoomAttr = () =>
    a.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { zoom?: number | null };
      return attrs.zoom ?? null;
    });

  // Hover reveals the toolbar. Zoom in: the view stands...
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await expect(iframe).toHaveAttribute("style", /scale\(1\.2\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("120%");

  // ...and the debounce lands it over the block's attrs (the persist's
  // write): the doc holds the view, and pane B's embed adopts it over the
  // wire (the panes share the persisted view).
  await expect.poll(zoomAttr, SETTLE).toBeCloseTo(1.2);
  await expect(iframeB).toHaveAttribute("style", /scale\(1\.2\)/, SETTLE);

  // The reset stands the cleared view (the null idiom) over the wire.
  await embed.locator('[data-slot="docblocks/embed-zoom-reset"]').click();
  await expect(iframe).toHaveAttribute("style", /translate\(0px(, 0px)?\)\s*scale\(1\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("100%");
  await expect(iframeB).toHaveAttribute("style", /translate\(0px(, 0px)?\)\s*scale\(1\)/, SETTLE);
  await expect.poll(zoomAttr, SETTLE).toBeNull();

  await close();
});

test("the embed's wheel: ctrl/cmd zooms at the cursor, a plain wheel pans (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "embed-wheel");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  const readScale = async (): Promise<number> => {
    const style = (await iframe.getAttribute("style")) ?? "";
    const match = style.match(/scale\(([\d.]+)\)/);
    return match === null ? 1 : Number.parseFloat(match[1] ?? "1");
  };

  // ctrl+wheel (deltaY < 0) zooms in at the cursor: the scale grows.
  const box = (await embed.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const beforeZoom = await readScale();
  await embed.dispatchEvent("wheel", { deltaY: -240, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy });
  expect(await readScale()).toBeGreaterThan(beforeZoom);

  // A plain wheel pans vertically (content opposite to the delta): with the
  // overflow in place (zoomed in), the translate's y stands changed.
  const beforePan = (await iframe.getAttribute("style")) ?? "";
  await embed.dispatchEvent("wheel", { deltaY: 300, deltaMode: 0, clientX: cx, clientY: cy });
  const afterPan = (await iframe.getAttribute("style")) ?? "";
  expect(afterPan).not.toBe(beforePan);
  // The y translate moved (the vertical pan stood). The translate's
  // serialization stands engine-dependent (the firefox's engine omits the
  // zero second argument), so the parse takes the optional argument.
  const parseY = (s: string): number =>
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\)/)?.[2] ?? "0");
  expect(parseY(afterPan)).not.toBe(parseY(beforePan));

  await close();
});

test("the embed's modifier drag-pan: an Alt-held drag pans the overflow (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "embed-dragpan");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // Zoom in first (the toolbar) so the scaled embed overflows the wrapper.
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();

  const box = (await embed.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // An Alt-held drag pans (the iframe yields its pointer events to the
  // wrapper while the modifier stands — the re-render stands before the
  // press, so wait for the yield). The translate's x stands changed.
  await a.keyboard.down("Alt");
  await expect(iframe).toHaveCSS("pointer-events", "none", SETTLE);
  const beforeAlt = (await iframe.getAttribute("style")) ?? "";
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx - 60, cy, { steps: 4 });
  await a.mouse.up();
  await a.keyboard.up("Alt");
  const afterAlt = (await iframe.getAttribute("style")) ?? "";
  expect(afterAlt).not.toBe(beforeAlt);
  const parseX = (s: string): number =>
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px(?:,\s*(-?[\d.]+)px)?\)/)?.[1] ?? "0");
  expect(parseX(afterAlt)).toBeLessThan(parseX(beforeAlt));

  // An unmodified drag does NOT pan: the iframe keeps its own interaction
  // (the pan session requires the modifier), so the transform stands unchanged.
  const beforePlain = (await iframe.getAttribute("style")) ?? "";
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx - 60, cy, { steps: 4 });
  await a.mouse.up();
  expect((await iframe.getAttribute("style")) ?? "").toBe(beforePlain);

  await close();
});

test("the embed's pan/zoom survives the reload (the persisted view's restore)", async ({ page }) => {
  const room = `embed-persist-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  await insertType(page, "a", "embed");
  const embed = page.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // The persisted view's read over the block's attrs (the null idiom: the
  // identity's zoom stands `null` / absent).
  const zoomAttr = (): Promise<number | null> =>
    page.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { zoom?: number | null };
      return attrs.zoom ?? null;
    });

  // Zoom in twice (the toolbar): the view stands, and the debounce's write
  // lands over the block's attrs (the persist's stand)...
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await expect(iframe).toHaveAttribute("style", /scale\(1\.44\)/);
  await expect.poll(zoomAttr, SETTLE).toBeCloseTo(1.44);

  // ...and the reload's stand: the fresh mount's embed restores the
  // persisted view (the transform stands it — no flash of the identity).
  await page.reload();
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  const restored = page.locator(
    '[data-block-type="embed"]:not([data-slot="docblocks/row"]) iframe[data-slot="docblocks/embed"]'
  );
  await expect(restored).toHaveAttribute("style", /scale\(1\.44\)/, SETTLE);
});
