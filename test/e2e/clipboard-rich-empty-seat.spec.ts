/**
 * The rich `text/html` paste into an empty seat (the copy of the editor's
 * own text): the real default-copy payload carries the rendered inline style
 * (the browser serializes the computed `color` / `background-color` as an
 * `oklch()` value), and an empty seat (the caret in a blank block) is the
 * common paste target. The pins: the computed non-hex style is not a mark
 * (the paste never fails — the text lands clean instead of the insert
 * throwing and the transaction rolling back), the both-panes convergence over
 * the wire, the one-undo-step contract, the caret landing at the end, and the
 * empty-parse fallback (a rich payload that parses to nothing still takes the
 * plain branch when the plain carries content).
 *
 * Idempotency: a unique room per test (the relay keeps rooms for the dev
 * server's lifetime).
 */
import { type Browser, type Page, expect, test } from "@playwright/test";

const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

/**
 * The real default-copy `text/html` a browser writes for a text selection in
 * this editor: a `<meta charset>` + a `<span>` carrying the computed inline
 * style (the theme's oklch foreground + background) around the text. The
 * non-hex `color` / `background-color` must not stand the marks.
 */
const COMPUTED_STYLE_HTML =
  "<html><body><meta charset='utf-8'>" +
  '<span style="color: oklch(0.985 0 0); font-family: Inter, system-ui, sans-serif; font-size: 16px; white-space: pre-wrap; background-color: oklch(0.205 0 0); display: inline !important; float: none;">Hello world</span>' +
  "</body></html>";

async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  await contextA.grantPermissions(["clipboard-read", "clipboard-write"]);
  await contextB.grantPermissions(["clipboard-read", "clipboard-write"]);
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** The pane's root children as (type, text) pairs. */
async function rootBlocks(page: Page, client: "a" | "b") {
  return page.evaluate(
    ({ client }: { client: "a" | "b" }) => {
      const doc = window.__paneDocs?.[client];
      if (doc === undefined || doc === null) return null;
      const root = doc.meta.id;
      return doc.getChildren(root).map((id) => {
        const block = doc.getBlock(id);
        const text = block !== null && "content" in block ? (block.content ?? []).map((r) => r.text).join("") : "";
        return { id, type: block?.type ?? null, text };
      });
    },
    { client }
  );
}

/** Seed the OS clipboard with an explicit html + plain payload (either may be null). */
async function seedClipboard(page: Page, html: string | null, plain: string | null): Promise<void> {
  await page.evaluate(
    async ({ html, plain }) => {
      const types: Record<string, Blob> = {};
      if (html !== null) types["text/html"] = new Blob([html], { type: "text/html" });
      if (plain !== null) types["text/plain"] = new Blob([plain], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem(types)]);
    },
    { html, plain }
  );
}

/**
 * Paste the OS clipboard into the focused element (headless Chromium does not
 * synthesize the paste event): read both flavors back and dispatch a real-shape
 * paste event.
 */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const textOf = async (type: string): Promise<string | null> => {
      for (const item of items) {
        if (item.types.includes(type)) return (await item.getType(type)).text();
      }
      return null;
    };
    const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    if (html !== null) transfer.setData("text/html", html);
    if (plain !== null) transfer.setData("text/plain", plain);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  });
}

/** The inner contenteditable of the given block (the pane-scoped query). */
function innerOf(page: Page, client: "a" | "b", index: number) {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).nth(index);
}

test("a copy of the editor's own text (the computed oklch style) pastes clean into the empty block", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "clip-rich-empty");
  try {
    // The room starts with pane "a"'s single starter.
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(1);
    // Type the word in the starter (the block now carries text to copy).
    const firstA = innerOf(a, "a", 0);
    await firstA.click();
    await a.keyboard.type("Hello world");
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[0], SETTLE)
      .toMatchObject({
        type: "paragraph",
        text: "Hello world",
      });

    // Seed the clipboard with the real default-copy payload (the computed
    // oklch style span + the plain text) and paste into a fresh empty block.
    await seedClipboard(a, COMPUTED_STYLE_HTML, "Hello world");
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(2);
    await innerOf(a, "a", 1).click();
    await pasteFromClipboard(a);

    // The text lands clean in the empty block (the computed style is not a
    // mark — the paste never fails): a single paragraph run, no color /
    // highlight.
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });
    const runs = await a.evaluate(
      ({ client }) => {
        const doc = window.__paneDocs?.[client];
        const ids = doc?.getChildren(doc.meta.id) ?? [];
        return (doc?.getRuns(ids[1] ?? "") ?? []).map((r) => ({ text: r.text, marks: r.marks }));
      },
      { client: "a" as const }
    );
    expect(runs).toEqual([{ text: "Hello world", marks: {} }]);

    // The other pane converges to the same clean run over the wire.
    await expect
      .poll(async () => (await rootBlocks(b, "b"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });
    const runsB = await b.evaluate(
      ({ client }) => {
        const doc = window.__paneDocs?.[client];
        const ids = doc?.getChildren(doc.meta.id) ?? [];
        return (doc?.getRuns(ids[1] ?? "") ?? []).map((r) => ({ text: r.text, marks: r.marks }));
      },
      { client: "b" as const }
    );
    expect(runsB).toEqual([{ text: "Hello world", marks: {} }]);

    // One undo step reverts the paste (the single transact).
    await a.keyboard.press("Control+z");
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "" });

    // The caret landed at the end of the pasted content (before the undo):
    // re-paste and confirm typing appends to the pasted text.
    await pasteFromClipboard(a);
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });
    await a.keyboard.type("!");
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world!" });
  } finally {
    await close();
  }
});

test("the empty rich parse (the anchor-only payload) falls back to the plain branch", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "clip-rich-fallback");
  try {
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(1);
    // The rich payload is the line-anchor span only (a copy of a soft-break
    // line): the rich parse materializes nothing, but the plain carries the
    // text — the paste must take the plain branch, not a silent no-op.
    const anchorHtml =
      '<html><body><span data-slot="docblocks/line-anchor" contenteditable="false">\u200B</span></body></html>';
    await seedClipboard(a, anchorHtml, "Hello world");
    await innerOf(a, "a", 0).click();
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(2);
    await innerOf(a, "a", 1).click();
    await pasteFromClipboard(a);

    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });
  } finally {
    await close();
  }
});

test("the both-variants parity (the html+plain and the plain-only copies stand the same content)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "clip-rich-parity");
  try {
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(1);

    // Variant 1: the html + plain copy into the second block.
    await seedClipboard(a, COMPUTED_STYLE_HTML, "Hello world");
    await innerOf(a, "a", 0).click();
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(2);
    await innerOf(a, "a", 1).click();
    await pasteFromClipboard(a);
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[1], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });

    // Variant 2: the plain-only copy into the third block.
    await seedClipboard(a, null, "Hello world");
    await a.keyboard.press("Enter");
    await expect.poll(async () => (await rootBlocks(a, "a"))?.length, SETTLE).toBe(3);
    await innerOf(a, "a", 2).click();
    await pasteFromClipboard(a);
    await expect
      .poll(async () => (await rootBlocks(a, "a"))?.[2], SETTLE)
      .toMatchObject({ type: "paragraph", text: "Hello world" });
  } finally {
    await close();
  }
});
