// The @ mention's chip's stand: the plain text's presentation (the kind's icon, bold + underline,
// the row height) + the plain-text's guards (@ in a code block, @ after a character).
import { expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";
import { editorOf, typeMentionPhrase } from "./mention-helpers";

test("the chip stands as plain text (the kind's icon, bold + underline, the row height unchanged)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "mention-stand");
  // The plain baseline row + the mention row (a user pick over `@Ada`).
  const plainId = await insertBlockType(a, "a", "paragraph");
  const plainInner = a.locator(
    `[data-testid="doc-a"] [data-block-id="${plainId}"][data-slot="docblocks/block-content"]`
  );
  await plainInner.click();
  await a.keyboard.type("plain text line");

  const mentionId = await insertBlockType(a, "a", "paragraph");
  await typeMentionPhrase(a, "a", mentionId, "@Ada");
  const picker = a.locator('[data-slot="docblocks/mention-menu"]');
  await expect.poll(async () => picker.getByText("Ada Lovelace").isVisible(), SETTLE).toBe(true);
  await picker.getByText("Ada Lovelace").click();

  const chip = editorOf(a, "a").locator(`[data-block-id="${mentionId}"] [data-slot="docblocks/mention"]`);
  await expect.poll(async () => chip.count(), SETTLE).toBe(1);

  // The stand: the kind's decorative inline icon + the label (the chip
  // carries the target id for the consumer's live-label stands).
  await expect(chip.locator("svg")).toHaveCount(1);
  await expect(chip).toHaveAttribute("data-mention-id", "u1");

  // The computed stand: the semibold + the underline, no pill of its own.
  const style = await chip.evaluate((el) => {
    const cs = window.getComputedStyle(el);
    return { weight: cs.fontWeight, line: cs.textDecorationLine, background: cs.backgroundColor };
  });
  expect(style.weight).toBe("600");
  expect(style.line).toBe("underline");
  expect(style.background).toBe("rgba(0, 0, 0, 0)");

  // The row height: the mention row stands the plain row's height (the
  // chip is an inline run — no box of its own over the text line).
  const [plainHeight, mentionHeight] = await a.evaluate(
    ({ plain, mention }) => {
      const row = (id: string) => document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
      return [row(plain)!.getBoundingClientRect().height, row(mention)!.getBoundingClientRect().height];
    },
    { plain: plainId, mention: mentionId }
  );
  expect(Math.abs(plainHeight - mentionHeight)).toBeLessThanOrEqual(0.5);

  await close();
});

test("@ in a code block is plain text (no picker)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-code");
  const blockId = await insertBlockType(a, "a", "code");
  await typeMentionPhrase(a, "a", blockId, "@Ada");

  // The picker does not stand (code is excluded — the exclusion idiom).
  await a.waitForTimeout(300);
  expect(await a.locator('[data-slot="docblocks/mention-menu"]').count()).toBe(0);
  const text = await a.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      const block = doc?.getBlock(id);
      return block === null || block === undefined || !("content" in block)
        ? ""
        : block.content?.map((r) => r.text).join("");
    },
    { client: "a", id: blockId }
  );
  expect(text).toBe("@Ada");

  await close();
});

test("@ after a character is plain text (no picker — the email's stand)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "mention-email");
  const blockId = await insertBlockType(a, "a", "paragraph");
  // The email: the `@` at a non-boundary (after a letter) declines the
  // trigger — the picker must not stand while the email is typed.
  await typeMentionPhrase(a, "a", blockId, "john@yandex.ru");

  await a.waitForTimeout(300);
  expect(await a.locator('[data-slot="docblocks/mention-menu"]').count()).toBe(0);
  const text = await a.evaluate(
    ({ client, id }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      const block = doc?.getBlock(id);
      return block === null || block === undefined || !("content" in block)
        ? ""
        : block.content?.map((r) => r.text).join("");
    },
    { client: "a", id: blockId }
  );
  expect(text).toBe("john@yandex.ru");

  await close();
});
