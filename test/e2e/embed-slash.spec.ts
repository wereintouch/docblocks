// The slash Embed form over the wire: the commit's phrase strip (the block's land + the one
// undo step), and the Escape's cancel (the no-write's stand).
import { expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

test("the slash Embed form inserts an embed block (the phrase strip, one undo step, over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "embed-slash");
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

  // Fill the URL and commit: the phrase strips and the embed block lands
  // over the wire (the doc holds the URL and the `iframe` kind, and nothing
  // else — the form stands the URL only, the kind's default stands the
  // committed attr).
  await urlInput.fill("https://example.com/embedded");
  await form.locator("[data-slot='docblocks/slash-embed-insert']").click();

  const wrapper = a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])");
  await expect(wrapper).toHaveCount(1, SETTLE);
  await expect(wrapper).toHaveAttribute("data-kind", "iframe");
  const iframe = wrapper.locator('iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveAttribute("src", "https://example.com/embedded");

  // The doc holds only the committed attrs (the phrase is stripped).
  const attrs = await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    const state = doc.toJSON();
    const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed")!;
    return state.blocks[embedId]!.attrs;
  });
  expect(attrs).toEqual({ kind: "iframe", src: "https://example.com/embedded" });

  // Pane B receives the embed over the wire.
  await expect(b.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])[data-kind='iframe']")).toHaveCount(
    1,
    SETTLE
  );

  // The insert is one undo step: Ctrl+Z removes the embed block.
  await a.keyboard.press("Control+z");
  await expect(a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])")).toHaveCount(0, SETTLE);

  await close();
});

test("the slash Embed form's Escape cancels (commits nothing, the phrase stands)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "embed-slash-cancel");
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
  expect(await a.locator("[data-block-type='embed']:not([data-slot='docblocks/row'])").count()).toBe(0);
  // The phrase is intact (the "/embed" still stands in the text).
  const text = await inner.innerText();
  expect(text).toContain("/embed");

  await close();
});
