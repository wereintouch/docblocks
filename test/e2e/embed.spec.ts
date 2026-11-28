import { type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

test("an embed inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "embed-base");

  await insertType(a, "a", "embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);

    // The plain iframe with the harness's fixed data: URL src (the `html`
    // kind — the write gate's only data-scheme stand)...
    const iframe = doc.locator('iframe[data-slot="docblocks/embed"]');
    await expect(iframe).toHaveCount(1);
    expect((await iframe.getAttribute("src")) ?? "").toContain("data:text/html");
    // ...and the kind on the wrapper (v1: every kind renders as an iframe).
    await expect(
      doc.locator('[data-block-type="embed"]:not([data-slot="docblocks/row"])[data-kind="html"]')
    ).toHaveCount(1);
    // Not text-editable: the wrapper carries no inner editable.
    expect(
      await doc
        .locator('[data-block-type="embed"]:not([data-slot="docblocks/row"]) [data-slot="docblocks/block-content"]')
        .count()
    ).toBe(0);
  }

  // The JSON inspector of pane A shows the embed attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "embed"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "html"');
  expect(jsonText).toContain("data:text/html");

  await close();
});

test("the catalog's embed renders in the motion pane (a non-text reorder target)", async ({ page }) => {
  const room = `embed-motion-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The catalog embed is one of the root entries: it renders through the
  // motion view (no enter animation for entries present at mount) and is
  // not a drag source (no gutter handle on the wrapper).
  const embed = page.locator('[data-block-type="embed"]:not([data-slot="docblocks/row"])');
  await expect(embed).toHaveCount(1);
  await expect(embed).toHaveAttribute("data-kind", "html");
  await expect(embed.locator('[data-slot="docblocks/embed"]')).toBeVisible();
  expect(await embed.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
});

test("the embed's bottom-edge resize stretches the block (the persisted height: the wire's adopt + the reload's restore)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "embed-resize");
  await insertType(a, "a", "embed");
  const wrapper = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(wrapper).toHaveCount(1, SETTLE);

  // The height's read over the block's attrs (the null idiom: the default's
  // stand stands `null` / absent). Each pane's doc stands read over its own
  // page (the harness's `__paneDocs` exposes the page's own doc only).
  const heightAttr = (client: "a" | "b") =>
    (client === "a" ? a : b).evaluate((which: "a" | "b") => {
      const doc = (which === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return null;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { height?: number | null };
      return attrs.height ?? null;
    }, client);

  // The default's stand: the token's height (the minimum's stand).
  const defaultHeight = await wrapper.evaluate((el) => el.getBoundingClientRect().height);
  expect(await heightAttr("a")).toBeNull();

  // The hover's reveal stands the handle (the grip's bar's stand); the
  // bottom-edge's drag down 120 px stands the stretch...
  await wrapper.hover();
  const handle = wrapper.locator('[data-slot="docblocks/embed-resize"]');
  await expect(handle).toBeAttached();
  const box = (await wrapper.boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height - 4; // the handle's band (the bottom's 8 px)
  await a.mouse.move(startX, startY);
  await a.mouse.down();
  await a.mouse.move(startX, startY + 120, { steps: 5 });
  await a.mouse.up();

  // ...the wrapper's height stands the stretch, and the rest's write lands
  // the px over the block's attrs (the persist's stand).
  const stretchedHeight = await wrapper.evaluate((el) => el.getBoundingClientRect().height);
  expect(stretchedHeight).toBeGreaterThan(defaultHeight);
  await expect.poll(() => heightAttr("a"), SETTLE).toBeCloseTo(stretchedHeight, 0);

  // The wire's adopt: pane B's embed stands the stretched height over the
  // peer's write (the panes' shared view).
  const wrapperB = b.locator('[data-testid="doc-b"] [data-block-type="embed"]:not([data-slot="docblocks/row"])');
  await expect
    .poll(() => wrapperB.evaluate((el) => el.getBoundingClientRect().height), SETTLE)
    .toBeCloseTo(stretchedHeight, 0);

  // The reload's stand: the fresh mount's embed restores the stretched
  // height (the transform's stand: no flash of the default).
  await a.reload();
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  const restored = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect
    .poll(() => restored.evaluate((el) => el.getBoundingClientRect().height), SETTLE)
    .toBeCloseTo(stretchedHeight, 0);

  await close();
});

test("the toolbar's edit changes the embed's URL (the commit's write over the wire; the cancel's no-write)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "embed-editurl");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // The src's read over the block's attrs (each pane's doc stands read over
  // its own page — the harness's `__paneDocs` exposes the page's own doc only).
  const src = (client: "a" | "b") =>
    (client === "a" ? a : b).evaluate((which: "a" | "b") => {
      const doc = (which === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return null;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { src?: string };
      return attrs.src ?? null;
    }, client);

  // The edit's open: the hover's reveal + the button's click stands the panel
  // over the current src (the pre-fill's stand), the input's focused.
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-edit-url"]').click();
  const input = embed.locator('[data-slot="docblocks/embed-edit-input"]');
  await expect(input).toBeFocused(SETTLE);
  expect(await input.inputValue()).toContain("data:text/html");

  // The commit's Enter: the new src stands the doc's write + the iframe's
  // navigation, and pane B adopts it over the wire (the panes' shared src).
  await input.fill("https://example.com/embedded");
  await input.press("Enter");
  await expect(iframe).toHaveAttribute("src", "https://example.com/embedded");
  await expect.poll(() => src("a"), SETTLE).toBe("https://example.com/embedded");
  const iframeB = b.locator(
    '[data-testid="doc-b"] [data-block-type="embed"]:not([data-slot="docblocks/row"]) iframe[data-slot="docblocks/embed"]'
  );
  await expect(iframeB).toHaveAttribute("src", "https://example.com/embedded", SETTLE);
  await expect.poll(() => src("b"), SETTLE).toBe("https://example.com/embedded");

  // The cancel's stand: the panel's open, the draft's change, the Escape's
  // close writes nothing (the src's untouched, the panel's gone).
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-edit-url"]').click();
  await embed.locator('[data-slot="docblocks/embed-edit-input"]').fill("https://example.com/other");
  await embed.locator('[data-slot="docblocks/embed-edit-input"]').press("Escape");
  await expect(embed.locator('[data-slot="docblocks/embed-edit"]')).toBeHidden(SETTLE);
  expect(await src("a")).toBe("https://example.com/embedded");

  await close();
});
