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

/** Insert one v1 type at the root through the pane's harness control. */
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

test("an embed inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed");

  await insertType(a, "a", "embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);

    // The plain iframe with the harness's fixed data: URL src...
    const iframe = doc.locator('iframe[data-slot="docblocks/embed"]');
    await expect(iframe).toHaveCount(1);
    expect((await iframe.getAttribute("src")) ?? "").toContain("data:text/html");
    // ...and the kind on the wrapper (v1: every kind renders as an iframe).
    await expect(doc.locator('[data-block-type="embed"][data-kind="iframe"]')).toHaveCount(1);
    // Not text-editable: the wrapper carries no inner editable.
    expect(await doc.locator('[data-block-type="embed"] [data-slot="docblocks/block-content"]').count()).toBe(0);
  }

  // The JSON inspector of pane A shows the embed attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "embed"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "iframe"');
  expect(jsonText).toContain("data:text/html");

  await close();
});

test("the catalog's embed renders in the motion pane (a non-text reorder target)", async ({ page }) => {
  const room = `ext01-motion-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The catalog embed is one of the root entries: it renders through the
  // motion view (no enter animation for entries present at mount) and is
  // not a drag source (no gutter handle on the wrapper).
  const embed = page.locator('[data-block-type="embed"]');
  await expect(embed).toHaveCount(1);
  await expect(embed).toHaveAttribute("data-kind", "iframe");
  await expect(embed.locator('[data-slot="docblocks/embed"]')).toBeVisible();
  expect(await embed.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
});

test("the slash Embed form inserts an embed block (the phrase strip, one undo step, over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-slash");
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await a.keyboard.type("/embed");

  const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem, "the Embed command filters to one entry").toHaveCount(1, SETTLE);
  await expect(menuItem).toHaveText("Embed");
  await a.keyboard.press("Enter");

  // The form stands over the open menu (the phrase intact), the URL input auto-focused.
  const form = a.locator("[data-slot='docblocks/slash-embed-form']");
  await expect(form).toBeVisible(SETTLE);
  const urlInput = form.locator("[data-slot='docblocks/slash-embed-url']");
  await expect(urlInput).toBeFocused(SETTLE);

  // A whitespace-only URL commits nothing (the form stands open on the phrase).
  await urlInput.fill("   ");
  expect(await form.locator("[data-slot='docblocks/slash-embed-insert']").isDisabled()).toBe(true);

  // Fill the URL, pick a kind, and commit: the phrase strips and the embed
  // block lands over the wire (the doc holds the URL, the kind, and nothing else).
  await urlInput.fill("https://example.com/embedded");
  await form.locator("[data-slot='docblocks/slash-embed-kind']").selectOption("github");
  await form.locator("[data-slot='docblocks/slash-embed-insert']").click();

  const wrapper = a.locator("[data-block-type='embed']");
  await expect(wrapper).toHaveCount(1, SETTLE);
  await expect(wrapper).toHaveAttribute("data-kind", "github");
  const iframe = wrapper.locator('iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveAttribute("src", "https://example.com/embedded");

  // The doc holds only the committed attrs (the phrase is stripped).
  const attrs = await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    const state = doc.toJSON();
    const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed")!;
    return state.blocks[embedId]!.attrs;
  });
  expect(attrs).toEqual({ kind: "github", src: "https://example.com/embedded" });

  // Pane B receives the embed over the wire.
  await expect(b.locator("[data-block-type='embed'][data-kind='github']")).toHaveCount(1, SETTLE);

  // The insert is one undo step: Ctrl+Z removes the embed block.
  await a.keyboard.press("Control+z");
  await expect(a.locator("[data-block-type='embed']")).toHaveCount(0, SETTLE);

  await close();
});

test("the slash Embed form's Escape cancels (commits nothing, the phrase stands)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-slash-cancel");
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await a.keyboard.type("/embed");

  const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem).toHaveCount(1, SETTLE);
  await a.keyboard.press("Enter");

  const form = a.locator("[data-slot='docblocks/slash-embed-form']");
  await expect(form).toBeVisible(SETTLE);
  await form.locator("[data-slot='docblocks/slash-embed-url']").fill("https://example.com/nope");

  // Escape cancels the form: the command list stands back on the phrase, no
  // embed block lands.
  await form.locator("[data-slot='docblocks/slash-embed-url']").press("Escape");
  await expect(form).toBeHidden(SETTLE);
  expect(await a.locator("[data-block-type='embed']").count()).toBe(0);
  // The phrase is intact (the "/embed" still stands in the text).
  const text = await inner.innerText();
  expect(text).toContain("/embed");

  await close();
});

test("the embed's hover toolbar zooms and resets (view state, the doc stands invariant)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-panzoom");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');
  const iframeB = b.locator('[data-testid="doc-b"] [data-block-type="embed"] iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveAttribute("style", /scale\(1\)/);

  // The doc's state before any pan/zoom (the view state must not reach it).
  const before = await a.evaluate(() => JSON.stringify(window.__paneDocs!.a!.toJSON()));

  // Hover reveals the toolbar.
  await embed.hover();
  const toolbar = embed.locator('[data-slot="docblocks/embed-toolbar"]');
  await expect(toolbar).toBeVisible(SETTLE);

  // Zoom in: the scale and the label stand, the transform's scale grows.
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await expect(iframe).toHaveAttribute("style", /scale\(1\.2\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("120%");

  // The other pane's embed stands the identity (the view state is per-editor:
  // pane A's zoom never reaches pane B's transform).
  await expect(iframeB).toHaveAttribute("style", /translate\(0px, 0px\) scale\(1\)/, SETTLE);

  // The doc is untouched: the pan/zoom is pure view state (the wire and the
  // other pane stand invariant).
  const after = await a.evaluate(() => JSON.stringify(window.__paneDocs!.a!.toJSON()));
  expect(after).toBe(before);

  // Reset restores the identity (the scale and the translate return to zero).
  await embed.locator('[data-slot="docblocks/embed-zoom-reset"]').click();
  await expect(iframe).toHaveAttribute("style", /translate\(0px, 0px\) scale\(1\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("100%");

  await close();
});

test("the embed's wheel: ctrl/cmd zooms at the cursor, a plain wheel pans (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-wheel");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
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
  // The y translate moved (the vertical pan stood).
  const parseY = (s: string): number =>
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)?.[2] ?? "0");
  expect(parseY(afterPan)).not.toBe(parseY(beforePan));

  await close();
});

test("the embed's modifier drag-pan: an Alt-held drag pans the overflow (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-dragpan");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
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
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)?.[1] ?? "0");
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
