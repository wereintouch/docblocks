import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** The pane's rendered presence carets (the peer's selections accepted over the grant). */
const carets = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/presence-caret"]`);

test("the default grant is off: the selection stands unpublished, the roster stands", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pres-01-off");
  try {
    const blockA = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await blockA.click();
    await a.keyboard.type("off");

    // The sharer's stand: the grant label stands "off" (the local state is
    // the full information over the sharer's pane).
    await expect(a.getByTestId("presence-share-a-label")).toHaveText("off");

    // B's presence panel lists A's identity (the roster's stand — the
    // identity frame stands even over the invisible selection). The
    // frame's arrival is the positive stand before the absence's assert.
    await expect.poll(async () => await b.getByTestId("peer-b-user-a").innerText(), SETTLE).toContain("user: user-a");
    await expect(carets(b, "b")).toHaveCount(0);
  } finally {
    await close();
  }
});

test('the "everyone" grant: the plaintext caret lands over the room', async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pres-02-everyone");
  try {
    const blockA = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await blockA.click();
    await a.keyboard.type("everyone");

    // The grant flip re-publishes immediately (no debounce): the plaintext
    // selection lands, B's caret renders over A's block.
    await a.getByTestId("share-a-everyone").click();
    await expect(a.getByTestId("presence-share-a-label")).toHaveText("everyone");
    await expect.poll(async () => await carets(b, "b").count(), SETTLE).toBeGreaterThanOrEqual(1);
  } finally {
    await close();
  }
});

test("the targeted grant: the addressed peer sees the caret", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pres-03-target");
  try {
    const blockA = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await blockA.click();
    await a.keyboard.type("target");

    // The grant stands the addressed peer's id (the harness's target
    // button: user-b). The flip publishes the ciphertext frame; B's cipher
    // opens the entry addressed to it.
    await a.getByTestId("share-a-target").click();
    await expect(a.getByTestId("presence-share-a-label")).toHaveText("user-b");
    await expect.poll(async () => await carets(b, "b").count(), SETTLE).toBeGreaterThanOrEqual(1);
  } finally {
    await close();
  }
});

test("the targeted grant over a stranger: the peer stands no caret, the roster stands", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "pres-04-stranger");
  try {
    const blockA = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
    await blockA.click();
    await a.keyboard.type("stranger");

    // The grant stands the absent user (user-x): B is not the addressed
    // peer — B's cipher refuses the entry (the targeted's privacy stand).
    await a.getByTestId("share-a-stranger").click();
    await expect(a.getByTestId("presence-share-a-label")).toHaveText("user-x");

    // The ciphertext frame's arrival is the positive stand (the panel's
    // enc's line stands the raw frame's selections over B's wire's view);
    // over it the caret's absence is stable (no decrypt, no render).
    await expect.poll(async () => await b.getByTestId("peer-b-user-a").innerText(), SETTLE).toContain("enc: 1");
    await expect(carets(b, "b")).toHaveCount(0);
    // The roster's stand: A's identity stands over the invisible selection.
    await expect(b.getByTestId("peer-b-user-a")).toContainText("user: user-a");
  } finally {
    await close();
  }
});
