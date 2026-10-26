import { type Browser, type Locator, type Page, expect, test } from "@playwright/test";

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

/** The pane's mermaid code block wrapper (the data-language attr comes from the block). */
function mermaidBlock(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`).locator('[data-block-type="code"][data-language="mermaid"]');
}

/**
 * Switch the pane's mermaid block to the preview mode: the header controls
 * stand on the wrapper hover, the mode switch is one updateBlock (the attr
 * syncs — the other pane renders the diagram too).
 */
async function switchToPreview(page: Page, client: "a" | "b"): Promise<void> {
  const block = mermaidBlock(page, client);
  await block.first().hover();
  await block.first().locator('[data-mermaid-mode-button="preview"]').click();
}

/**
 * The sliding pill sits exactly on the given button (the measured
 * geometry). The delta is POLLED — `boundingBox` does not retry, so a
 * single snapshot could sample the 200 ms slide transition mid-flight.
 */
async function pillOnButton(block: Locator, button: Locator): Promise<void> {
  const pill = block.locator('[data-slot="docblocks/mermaid-mode-pill"]');
  await expect
    .poll(
      async () => {
        const p = await pill.boundingBox();
        const t = await button.boundingBox();
        if (p === null || t === null) return Number.POSITIVE_INFINITY;
        return Math.abs(p.x - t.x) + Math.abs(p.y - t.y);
      },
      { timeout: SETTLE.timeout }
    )
    .toBeLessThan(1);
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

test("the diagram follows the editor's theme (EXT-02: the dark stand + a flip re-renders)", async ({ browser }) => {
  const context = await browser.newContext();
  const a = await context.newPage();
  try {
    // A unique room per run (the twoPanes suffix stand): the relay keeps the
    // room's doc for the dev server's lifetime, so a fixed room name would
    // stand the previous run's blocks (the diagram count's assertion is
    // document-wide).
    await openPane(a, "a", `ext02-theme-${Math.random().toString(36).slice(2, 8)}`);
    await insertType(a, "a", "code-mermaid");
    const block = mermaidBlock(a, "a");
    await switchToPreview(a, "a");
    const diagram = block.locator('[data-slot="docblocks/mermaid"][data-state="diagram"] svg');
    await expect(diagram).toHaveCount(1, SETTLE);

    // The scoped <style> of the rendered svg carries the theme's stand:
    // the dark theme renders the light ink on the dark canvas, the
    // default theme the dark ink.
    const readStyle = async () =>
      a.evaluate(
        () =>
          document
            .querySelector('[data-testid="doc-a"] [data-slot="docblocks/mermaid"][data-state="diagram"] svg')
            ?.querySelector("style")?.textContent ?? "NO-STYLE"
      );
    // The harness loads dark by default.
    expect(await readStyle()).toContain("font-size:16px;fill:#ccc");

    // A theme flip (the dark class leaves <html>) re-renders the diagram
    // in the default (light) theme.
    await a.evaluate(() => document.documentElement.classList.remove("dark"));
    await expect.poll(readStyle, SETTLE).not.toContain("font-size:16px;fill:#ccc");
    expect(await readStyle()).toContain("font-size:16px;fill:#333");
  } finally {
    await context.close();
  }
});

test("a mermaid code block inserted in A switches to the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid");

  await insertType(a, "a", "code-mermaid");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const block = mermaidBlock(pane, client);
    await expect(block).toHaveCount(1);
    // The default mode (code): the editable code stands, the diagram is
    // not rendered (the modes are exclusive).
    expect(await block.locator('[data-slot="docblocks/mermaid"]').count()).toBe(0);
    expect(await block.locator('[data-slot="docblocks/block-content"]').count()).toBe(1);
    // The sliding pill sits exactly on the active (code) button (the pill
    // is the highlight; it slides on a mode switch).
    await block.hover();
    await pillOnButton(block, block.locator('[data-mermaid-mode-button="code"]'));
  }

  // The preview switch in A writes the mode attr — it syncs over the
  // wire, so both panes render the diagram from the synced text.
  await switchToPreview(a, "a");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const block = mermaidBlock(pane, client);
    // The seed diagram renders as an svg inside the block wrapper in both
    // panes (the renderer is registered on both — the harness demo).
    await expect(block.locator('[data-slot="docblocks/mermaid"] svg')).toHaveCount(1);
    await expect(preview(pane, client)).toHaveAttribute("data-state", "diagram");
    // The editable stays mounted (the code body is hidden, not unmounted).
    expect(await block.locator('[data-slot="docblocks/block-content"]').count()).toBe(1);
    // The pill has slid to the preview button (the same geometry pin after
    // the switch — the transition's end state).
    await block.hover();
    await pillOnButton(block, block.locator('[data-mermaid-mode-button="preview"]'));
  }

  // The JSON inspector of pane A shows the code type + the attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"language": "mermaid"'), SETTLE).toBe(true);
  expect(await jsonA.innerText()).toContain('"type": "code"');
  expect(await jsonA.innerText()).toContain('"mermaidMode": "preview"');

  await close();
});

test("typing in the code block re-renders the diagram in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext02-mermaid-live");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");

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

  // The preview switch renders the diagram from the edited text: the new
  // node label reaches the diagram in both panes (the text synced over
  // the wire, the renderer picks the preview mode from the synced attr).
  await switchToPreview(a, "a");
  await expect.poll(() => diagramHasNode(a, "a", "C"), SETTLE).toBe(true);
  await expect(preview(a, "a")).toHaveAttribute("data-state", "diagram");
  await expect.poll(() => diagramHasNode(b, "b", "C"), SETTLE).toBe(true);

  await close();
});

test("an invalid diagram keeps no svg and shows the error state", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext02-mermaid-error");

  await insertType(a, "a", "code-mermaid");
  const blockA = mermaidBlock(a, "a");

  // Replace the seed with an incomplete diagram IN THE CODE MODE (the
  // editable stands there): select-all, delete (the DOM input diff commits
  // the empty text), then paste the invalid text (the multi-line input
  // route for code blocks, see pastePlainText).
  const inner = blockA.locator('[data-slot="docblocks/block-content"]');
  await inner.click();
  await a.keyboard.press("ControlOrMeta+a");
  await a.keyboard.press("Backspace");
  await pastePlainText(a, "graph TD\n A -->");

  // The preview switch renders the error state: no svg (the error state
  // renders the raw text with the error flag — asserted by the attribute,
  // not the look), and the message shows (the Alert's triangle icon is
  // chrome, not a diagram — the diagram container itself is absent).
  await switchToPreview(a, "a");
  await expect(blockA.locator('[data-slot="docblocks/mermaid-diagram"]')).toHaveCount(0);
  await expect(preview(a, "a")).toHaveAttribute("data-state", "error");
  await expect(blockA.locator('[data-slot="docblocks/mermaid-error"]')).toHaveText("graph TD\n A -->");
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
  const { a, close } = await twoPanes(browser, "ext02-mermaid-hover");

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
