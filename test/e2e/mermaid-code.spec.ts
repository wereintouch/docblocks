// The code chrome around the mermaid override: the plain code block's editability over the
// built-in path, and the header's controls' stand over the open more menu (the portaled
// menu loses the block's hover).
import { type Page, expect, test } from "@playwright/test";

import { insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/** The pane's mermaid code block wrapper (the data-language attr comes from the block). */
function mermaidBlock(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`).locator('[data-block-type="code"][data-language="mermaid"]');
}

test("a plain code block stays editable under the override", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mermaid-plain-code");

  // The harness registers the override on every pane: a non-mermaid code
  // block must still edit through the built-in contenteditable path.
  await insertType(a, "a", "code");
  const block = a.locator('[data-block-type="code"][data-language="ts"]');
  await expect(block).toHaveCount(1);
  expect(await block.locator('[data-slot="docblocks/block-content"] svg').count()).toBe(0);

  const inner = block.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await a.keyboard.type("const x = 1;");
  await expect(inner).toContainText("const x = 1;");

  await close();
});

test("the code header's controls stay visible while the more menu stands open (the portaled menu loses the block hover)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "mermaid-hover");

  await insertType(a, "a", "code-mermaid");
  const block = mermaidBlock(a, "a");
  await block.hover();

  const header = block.locator('[data-slot="docblocks/code-header"]');
  const leftGroup = header.locator(":scope > div").first();
  const actions = header.locator('[data-slot="docblocks/code-header-actions"]');
  // The hover state: both header groups stand visible.
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(leftGroup).toHaveCSS("opacity", "1");

  // Open the more menu and move the pointer ONTO the menu itself (it is
  // portaled outside the block — the block hover is gone): the controls
  // must stay visible.
  await block.locator('[data-slot="docblocks/code-more"]').click();
  const menu = a.locator('[data-slot="docblocks/code-more-menu"]');
  await expect(menu).toBeVisible();
  await menu.hover();
  await expect(actions).toHaveCSS("opacity", "1");
  await expect(leftGroup).toHaveCSS("opacity", "1");

  await close();
});
