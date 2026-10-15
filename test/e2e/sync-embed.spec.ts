import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs). The panes' master docs are
// shared through the `<room>-master` room: pane A seeds the master;
// pane B joins the empty room and receives the seed through the
// attach() bootstrap, so the embeds resolve the same master and edits
// converge (double-seeding with identical deterministic ids would
// duplicate the root order). `?cycle=1` seeds the master with a
// sync-embed that references the OUTER doc (the cycle-guard case).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string, cycle = false): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}${cycle ? "&cycle=1" : ""}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

/** Insert one harness type at the root through the pane's insert control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

async function twoPanes(
  browser: Browser,
  room: string,
  cycle = false
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom, cycle);
  await openPane(b, "b", uniqueRoom, cycle);
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

/** The pane's sync-embed wrapper (the first in DOM order: nested ones sit inside it). */
const wrapper = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-block-type="sync-embed"]`).first();

test("a sync-embed inserted in A shows the master content in both panes and the JSON carries the ref", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext03-full");

  await insertType(a, "a", "sync-embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const w = wrapper(pane, client);
    await expect(w).toHaveCount(1);
    await expect(w).toHaveAttribute("data-state", "resolved");
    // The seeded master content renders inside the wrapper…
    await expect(w.getByText("Master heading")).toBeVisible();
    await expect(w.getByText("Master paragraph three")).toBeVisible();
    // …and not in the outer block list: the pane's own doc carries no
    // heading, so the pane's single one is the master's, inside the wrapper.
    expect(await pane.locator(`[data-testid="doc-${client}"] [data-block-type="heading"]`).count()).toBe(1);
    expect(await w.locator('[data-block-type="heading"]').count()).toBe(1);
  }

  // The outer JSON inspector shows the ref (the master id only).
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "sync-embed"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"docId": "master-');
  expect(jsonText).not.toContain("Master heading");

  await close();
});

test("an edit inside the embed reaches the master and the other pane's embed", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext03-edit");

  await insertType(a, "a", "sync-embed");
  await expect(wrapper(a, "a")).toHaveAttribute("data-state", "resolved");

  // Click into the master's seeded paragraph INSIDE the embed (pane A) and
  // type at its end: the keystrokes commit to the MASTER doc.
  await wrapper(a, "a").getByText("Master paragraph one").click();
  await a.keyboard.press("End");
  await a.keyboard.type(" edited");

  // Pane B's embed sees it (the master room syncs the master)…
  await expect(wrapper(b, "b").getByText("Master paragraph one edited")).toBeVisible();

  // …and the outer doc's JSON stays the ref only.
  const jsonText = await a.getByTestId("json-a").innerText();
  expect(jsonText).toContain('"type": "sync-embed"');
  expect(jsonText).not.toContain("edited");

  await close();
});

test("a subtree sync-embed shows only the subtree block and edits reach the master", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext03-subtree");

  await insertType(a, "a", "sync-embed-subtree");

  const w = wrapper(a, "a");
  await expect(w).toHaveAttribute("data-state", "resolved");
  // The embed region contains ONLY the seeded subtree paragraph; the
  // master's other blocks are absent from the region.
  await expect(w.getByText("Master subtree paragraph")).toBeVisible();
  expect(await w.getByText("Master heading").count()).toBe(0);
  expect(await w.getByText("Master paragraph one").count()).toBe(0);
  expect(await w.getByText("Master paragraph three").count()).toBe(0);

  // Editing inside updates the master (pane B's embed sees it).
  await w.getByText("Master subtree paragraph").click();
  await a.keyboard.press("End");
  await a.keyboard.type(" edited");
  await expect(wrapper(b, "b").getByText("Master subtree paragraph edited")).toBeVisible();

  await close();
});

/** The pane's master's root sequence (the structural view the assertions read). */
async function masterState(
  page: Page,
  client: "a" | "b"
): Promise<{ id: string; type: string | null; indent: number | undefined }[] | null> {
  return page.evaluate((letter) => {
    const m = window.__masterDocs![letter as "a" | "b"]!;
    if (m === null) return null;
    return m.getChildren(m.meta.id).map((id) => {
      const block = m.getBlock(id);
      return {
        id,
        type: block?.type ?? null,
        indent: (block?.attrs as { indent?: number } | undefined)?.indent,
      };
    });
  }, client);
}

test("a subtree embed: the split gesture commits to the master and a peer's nested insert grows the segment", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext03-subtree-gesture");

  await insertType(a, "a", "sync-embed-subtree");
  const wa = wrapper(a, "a");
  await expect(wa).toHaveAttribute("data-state", "resolved");
  const wb = wrapper(b, "b");
  await expect(wb).toHaveAttribute("data-state", "resolved");
  await expect(wa.getByText("Master subtree paragraph")).toBeVisible();
  await expect(wb.getByText("Master subtree paragraph")).toBeVisible();

  // Gesture inside the subtree embed (pane A): Enter at the end of the
  // subtree root splits it — the split commits into the MASTER doc
  // against the root's sequence container (not the subtree root itself),
  // so the new paragraph lands in the master right after the root.
  await wa.getByText("Master subtree paragraph").click();
  await a.keyboard.press("End");
  await a.keyboard.press("Enter");

  // Pane B's master client sees the committed split (a new top-level
  // paragraph between the subtree root and the master's last paragraph).
  await expect
    .poll(async () => (await masterState(b, "b")) ?? [], SETTLE)
    .toEqual([
      { id: "m0001", type: "heading", indent: undefined },
      { id: "m0002", type: "paragraph", indent: undefined },
      { id: "m0003", type: "paragraph", indent: undefined },
      expect.objectContaining({ type: "paragraph", indent: undefined }),
      { id: "m0004", type: "paragraph", indent: undefined },
    ]);

  // Peer-side nested insert into the segment (pane B, pane A's embed): a
  // deeper block (indent 1) after the subtree root grows the root's
  // derived segment — the insert touches no subtree root, so only the
  // projection's re-derivation adds the row (no remount, no manual
  // refresh).
  const inserted = await b.evaluate(() => {
    const m = window.__masterDocs!.b!;
    if (m === null) return null;
    return m.insertBlock("paragraph", { indent: 1 }, { parent: m.meta.id, after: "m0003" });
  });
  expect(inserted).not.toBeNull();

  // Both panes' embed region shows the nested row — pane A without a
  // local edit to its master client — and the embeds stay resolved.
  await expect(wa.locator('[data-block-type="paragraph"]')).toHaveCount(2);
  await expect(wb.locator('[data-block-type="paragraph"]')).toHaveCount(2);
  await expect(wa).toHaveAttribute("data-state", "resolved");
  await expect(wb).toHaveAttribute("data-state", "resolved");

  await close();
});

test("a broken sync-embed (an unknown master id) renders the placeholder in both panes", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext03-broken");

  await insertType(a, "a", "sync-embed-broken");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const w = wrapper(pane, client);
    await expect(w).toHaveCount(1);
    await expect(w).toHaveAttribute("data-state", "broken");
    expect((await w.getAttribute("data-doc-id")) ?? "").toBe("missing-master");
    await expect(w.locator('[data-slot="docblocks/sync-embed-placeholder"]')).toBeVisible();
    // The page is alive (no cascade): the pane's own seed paragraph renders
    // (each pane seeds one, so the pane's doc holds one per pane).
    await expect(pane.locator(`[data-testid="doc-${client}"] [data-block-type="paragraph"]`).first()).toBeVisible();
  }

  // The outer JSON carries the ref.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes("missing-master"), SETTLE).toBe(true);

  await close();
});

test("a master that embeds the outer doc renders the cycle placeholder", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext03-cycle", true);

  await insertType(a, "a", "sync-embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const w = wrapper(pane, client);
    await expect(w).toHaveAttribute("data-state", "resolved");
    // The master's own sync-embed (the ref points at the outer doc's id)
    // re-enters the ancestor doc chain: the visited-set stops it.
    await expect(w.locator('[data-block-type="sync-embed"]')).toHaveCount(1);
    await expect(w.locator('[data-block-type="sync-embed"]')).toHaveAttribute("data-state", "cycle");
    await expect(w.locator('[data-slot="docblocks/sync-embed-placeholder"][data-state="cycle"]')).toBeVisible();
    // Finite depth: exactly two wrappers (the outer one + the inner cycle),
    // the page alive.
    expect(await pane.locator(`[data-testid="doc-${client}"] [data-block-type="sync-embed"]`).count()).toBe(2);
    await expect(pane.getByTestId(`status-${client}`)).toHaveText("connected");
  }

  await close();
});
