import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
}

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

/** The pane's mermaid code block wrapper (the data-language attr comes from the block). */
function mermaidBlock(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`).locator('[data-block-type="code"][data-language="mermaid"]');
}

/** The diagram preview container of the pane's mermaid block. */
function preview(page: Page, client: "a" | "b") {
  return mermaidBlock(page, client).locator('[data-slot="docblocks/mermaid"]');
}

/**
 * Paste a plain-text payload into the focused element: the payload is
 * dispatched as a paste event on the focused element (headless Chromium
 * does not synthesize a paste from Control+v). The editor's paste path
 * commits the text as doc commands — the real multi-line input route for
 * code blocks (Enter splits the block, so a keyboard newline is not the
 * diagram text).
 */
async function pastePlainText(page: Page, text: string): Promise<void> {
  await page.evaluate((value) => {
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    transfer.setData("text/plain", value);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  }, text);
}

/** Does the pane's diagram carry the node label? The v12 flowchart renders
 *  labels as HTML inside a <foreignObject> (no <text> elements), so the
 *  match is on the label's text content, exact. */
async function diagramHasNode(page: Page, client: "a" | "b", node: string): Promise<boolean> {
  const label = mermaidBlock(page, client).locator("svg").getByText(node, { exact: true });
  return (await label.count()) > 0;
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

test("a mermaid code block inserted in A renders the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid");

  await insertType(a, "a", "code-mermaid");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const block = mermaidBlock(pane, client);
    await expect(block, SETTLE).toHaveCount(1);
    // The seed diagram renders as an svg inside the block wrapper in both
    // panes: the text synced over the wire, the renderer is registered on
    // both (the harness demo).
    await expect(block.locator('[data-slot="docblocks/mermaid"] svg'), SETTLE).toHaveCount(1);
    await expect(preview(pane, client)).toHaveAttribute("data-state", "diagram");
    // The editable code path stays in place (the diagram is the preview
    // below the editable, not a replacement of it).
    expect(await block.locator('[data-slot="docblocks/block-content"]').count()).toBe(1);
  }

  // The JSON inspector of pane A shows the code type + the language attr.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"language": "mermaid"'), SETTLE).toBe(true);
  expect(await jsonA.innerText()).toContain('"type": "code"');

  await close();
});

test("typing in the code block re-renders the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid-live");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");
  await expect(blockA.locator('[data-slot="docblocks/mermaid"] svg'), SETTLE).toHaveCount(1);

  // The seed is "graph TD\n A --> B": appending " --> C" on the last line
  // chains a third node into the diagram (a single-line continuation —
  // Enter would split the block, not add a line). The click seats on the
  // last line explicitly (a center click of a two-line block stands on
  // the line boundary and resolves to the first line).
  const inner = blockA.locator('[data-slot="docblocks/block-content"]');
  const box = (await inner.boundingBox())!;
  await a.mouse.click(box.x + 20, box.y + box.height - 6);
  await a.keyboard.press("End");
  await a.keyboard.type(" --> C");

  // The svg re-renders from the real editing path: the new node label
  // reaches the diagram in both panes (the text synced over the wire).
  await expect.poll(() => diagramHasNode(a, "a", "C"), SETTLE).toBe(true);
  await expect(preview(a, "a")).toHaveAttribute("data-state", "diagram");
  await expect.poll(() => diagramHasNode(b, "b", "C"), SETTLE).toBe(true);

  await close();
});

test("an invalid diagram keeps no svg and shows the error state", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext02-mermaid-error");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");
  await expect(blockA.locator('[data-slot="docblocks/mermaid"] svg'), SETTLE).toHaveCount(1);

  // Replace the seed with an incomplete diagram: select-all, delete (the
  // DOM input diff commits the empty text), then paste the invalid text
  // (the multi-line input route for code blocks, see pastePlainText).
  const inner = blockA.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await a.keyboard.press("ControlOrMeta+a");
  await a.keyboard.press("Backspace");
  await pastePlainText(a, "graph TD\n A -->");

  // No diagram: the error state renders the raw text with the error flag
  // (asserted by the attribute, not the look), and the message shows
  // (the Alert's triangle icon is chrome, not a diagram — the diagram
  // container itself is absent).
  await expect(blockA.locator('[data-slot="docblocks/mermaid-diagram"]'), SETTLE).toHaveCount(0);
  await expect(preview(a, "a"), SETTLE).toHaveAttribute("data-state", "error");
  await expect(blockA.locator('[data-slot="docblocks/mermaid-error"]'), SETTLE).toHaveText("graph TD\n A -->");
  expect(await blockA.locator('[data-slot="docblocks/mermaid-error-message"]').count()).toBe(1);

  // The page stayed alive through the rejected render: the pane still
  // reports its connection state.
  await expect(a.getByTestId("status-a")).toHaveText("connected");

  // A rejected render leaves no temp container in the page (mermaid keeps
  // its working element in <body> on error unless suppressErrorRendering is
  // set — a page-level pin, since the block-scoped svg count above cannot
  // see the leak).
  expect(await a.locator("body > div[id^='dmb-']").count()).toBe(0);

  await close();
});

test("a plain code block stays editable under the override", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext02-plain-code");

  // The harness registers the override on every pane: a non-mermaid code
  // block must still edit through the built-in contenteditable path.
  await insertType(a, "a", "code");
  const block = a.locator('[data-block-type="code"][data-language="ts"]');
  await expect(block, SETTLE).toHaveCount(1);
  expect(await block.locator('[data-slot="docblocks/block-content"] svg').count()).toBe(0);

  const inner = block.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await a.keyboard.type("const x = 1;");
  await expect(inner, SETTLE).toContainText("const x = 1;");

  await close();
});
