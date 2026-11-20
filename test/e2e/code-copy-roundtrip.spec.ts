// The code block's copy button's round-trip (the distortion's gap's stand):
// the button copies the `text/html` payload (the `PRE` over the code's
// child, the language's class on the `code`'s element) + the
// `text/plain`'s fallback (the external app's stand); the paste into the
// empty paragraph materializes the code block verbatim (the markdown
// pipeline's distortion's guard — the newlines / the indentation / the
// markdown-flavored lines stand as the code's content), the language
// survives over the wire, and the paste into the code block keeps the
// plain payload's stand (the `plainWins`'s gate).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, pasteFromClipboard, readClipboardPayload, twoPanes } from "./helpers";

/** The fixture's content (the markdown-flavored lines stand the
 * verbatim's stand). */
const CODE = "if ok:\n\tgo()\nline1\nline2\ndef f():\n    return 1\n# heading\n---\n- item\n> quote";

const firstBlock = (page: Page, client: "a" | "b") =>
  page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) return null;
    const id = doc.getChildren(doc.toJSON().id)[0]!;
    const block = doc.getBlock(id);
    return {
      type: block?.type ?? null,
      language: (block as { attrs?: { language?: string } })?.attrs?.language ?? null,
      text: doc.getText(id),
    };
  }, client);

const lastBlock = (page: Page, client: "a" | "b") =>
  page.evaluate((c) => {
    const doc = window.__paneDocs?.[c];
    if (doc === null || doc === undefined) return null;
    const children = doc.getChildren(doc.toJSON().id);
    const id = children[children.length - 1]!;
    const block = doc.getBlock(id);
    return {
      type: block?.type ?? null,
      language: (block as { attrs?: { language?: string } })?.attrs?.language ?? null,
      text: doc.getText(id),
    };
  }, client);

/** Focus the pane's starter paragraph (the paste's target). */
async function focusStarterParagraph(page: Page, client: "a" | "b"): Promise<void> {
  const inner = page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
  await inner.click();
}

test("the copy's round-trip: the payload's stand (the html's + the plain's), the paste's materialization verbatim (the language's over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "code-copy-roundtrip", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    // The seed: the pane's starter paragraph + the code block's content.
    await a.evaluate((code) => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const block = doc.insertBlock("code", { language: "python" });
      doc.insertText(block, 0, code);
    }, CODE);
    await a.waitForTimeout(500); // the settle (the highlight's layer's mount's stand)
    const codeBlock = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block"][data-block-type="code"]').first();
    await expect(codeBlock).toBeVisible(SETTLE);

    // The copy's button (the real's click — the clipboard's write; the
    // header's hover's reveal's stand — the hover over the block first).
    await codeBlock.hover();
    await codeBlock.locator('[data-slot="docblocks/code-copy"]').click();
    await expect(codeBlock.locator('[data-slot="docblocks/code-copy"][data-copied="true"]')).toBeVisible();

    // The payload's stand: the html (the PRE's + the language's class's) +
    // the plain (the raw's text — the external app's stand).
    const payload = await readClipboardPayload(a);
    expect(payload.plain).toBe(CODE);
    expect(payload.html).toBe(
      `<pre><code class="language-python">${CODE.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</code></pre>`
    );

    // The paste into the starter paragraph (the paste's event's real's
    // pipeline over the OS clipboard's read): the code block's
    // materialization verbatim (the markdown's distortion's off), the
    // language's stand, the wire's parity over pane B.
    await focusStarterParagraph(a, "a");
    await pasteFromClipboard(a);
    const landed = await lastBlock(a, "a");
    expect(landed).toEqual({ type: "code", language: "python", text: CODE });
    await expect.poll(async () => lastBlock(b, "b"), SETTLE).toEqual({ type: "code", language: "python", text: CODE });
  } finally {
    await close();
  }
});

test("the paste into the code block keeps the plain payload's stand (the `plainWins`'s gate — the verbatim's raw text)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "code-copy-into-code", {
    permissions: ["clipboard-read", "clipboard-write"],
  });
  try {
    // The seed: the starter paragraph + the code block (the paste's target).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.insertBlock("code", { language: "python" });
    });
    // The clipboard's payload (the copy's button's stand's parity): the
    // html's + the plain's.
    await a.evaluate(async (code) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([`<pre><code class="language-python">${code}</code></pre>`], { type: "text/html" }),
          "text/plain": new Blob([code], { type: "text/plain" }),
        }),
      ]);
    }, CODE);

    // The paste over the code block's inner (the plain's payload's stand —
    // the html's pipeline's off): the raw's text over the block's end.
    const inner = a
      .locator(
        '[data-testid="doc-a"] [data-slot="docblocks/block"][data-block-type="code"] [data-slot="docblocks/block-content"]'
      )
      .first();
    await inner.click();
    await pasteFromClipboard(a);
    const landed = await firstBlock(a, "a");
    // The starter's paragraph stands (the first block's read); the code's
    // content stands the raw's text (the no-markdown's stand).
    const code = await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const children = doc.getChildren(doc.toJSON().id);
      const id = children.find((child) => doc.getBlock(child)?.type === "code")!;
      return doc.getText(id);
    });
    expect(code).toBe(CODE);
    expect(landed?.type).toBe("paragraph");
  } finally {
    await close();
  }
});
