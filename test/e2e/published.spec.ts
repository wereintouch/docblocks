// The published's stand (the consumer-controlled access's contract) — the
// A/B's flow over the harness's consumer stand (the publish.ts's shared
// localStorage — the e2e's contexts are isolated, so the handoff copies the
// stand from the editor's context to the viewer's context — the consumer's
// persistence's stand is the consumer's concern, the harness's stand is the
// localStorage). The security's stand: the viewer's pane holds NO live
// document (the reader's browser never gets the current state — the pane
// stands the published snapshot's stand read-only, the security's pin over
// the harness's __paneDocs' absent stand), the switcher's stand off (the
// published's forced stand), the placeholder over the absent snapshot (the
// reader stands no state at all), the snapshot's stand static over the
// live's edits, the snapshot's meta over the header (the live's meta stands
// off), and the editor's published's switcher (the snapshot's subtree's
// read-only's stand + the empty chains' collapse's parity).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

interface PaneJson {
  meta: { title: string; avatar: string | null };
  blocks: Record<string, { type: string; content?: { text: string; marks: Record<string, unknown> }[] }>;
}

/** The pane's live doc's JSON (the __paneDocs' harness stand). */
async function paneDocJson(page: Page, client: "a" | "b"): Promise<PaneJson> {
  return (await page.evaluate((c) => {
    const docs = window.__paneDocs;
    const doc = (c === "a" ? docs?.a : docs?.b) ?? null;
    if (doc === null) throw new Error("the pane's doc is not mounted");
    return doc.toJSON();
  }, client)) as unknown as PaneJson;
}

/** Reads the pane's room's published stand (null over the absent stand) —
 * the key stands from the pane's URL (the harness's publish.ts's stand). */
async function readPublishedStand(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    const room = new URLSearchParams(window.location.search).get("syncUrl")?.split("/").pop();
    if (room === undefined) throw new Error("the room's stand is absent");
    return window.localStorage.getItem(`docblocks-playground-published:${room}`);
  });
}

/** The publish's handoff: the editor's pane publishes, the stand is copied
 * to the peer's context's localStorage, and the peer re-reads its pane's
 * published stand (the __reloadPublished's harness path). */
async function handoffPublished(a: Page, b: Page): Promise<void> {
  await a.getByTestId("publish-a").click();
  const raw = await readPublishedStand(a);
  if (raw === null) throw new Error("the editor's pane's published stand is absent");
  await b.evaluate((value) => {
    const room = new URLSearchParams(window.location.search).get("syncUrl")?.split("/").pop();
    if (room === undefined) throw new Error("the room's stand is absent");
    window.localStorage.setItem(`docblocks-playground-published:${room}`, value);
  }, raw);
  const applied = await b.evaluate(() => window.__reloadPublished?.("b"));
  expect(applied, "the viewer's pane's re-read's stand").toBe(true);
}

test("the viewer's pane stands the snapshot over the publish's handoff (the switcher's stand off)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "pub-flow", { viewerB: true });
  try {
    // A: the live's content (the title + the text).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.setTitle("PUBLISHED TITLE");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "the published text");
    });
    await expect(a.locator('[data-slot="docblocks/page"]').first()).toContainText("the published text", SETTLE);
    // The handoff (A publishes, B re-reads the stand).
    await handoffPublished(a, b);
    // B: the snapshot's stand — the published's content renders read-only.
    const bDoc = b.locator('[data-testid="doc-b"]');
    // The security's stand: the viewer's pane holds no live document (the
    // reader's browser never gets the current state).
    expect(await b.evaluate(() => window.__paneDocs?.b)).toBeNull();
    await expect(bDoc.locator('[data-slot="docblocks/page"]').first()).toContainText("the published text", SETTLE);
    await expect(bDoc.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
    // B's header: the mode switcher's stand off (the viewer's gate) and the
    // snapshot's meta (the live's meta stands off).
    await expect(b.locator('[data-slot="docblocks/doc-header-mode"]')).toHaveCount(0);
    await expect(b.locator('[data-slot="docblocks/doc-header-title"]')).toContainText("PUBLISHED TITLE");
  } finally {
    await close();
  }
});

test("the viewer's pane stands the placeholder over the absent snapshot (the live's state stands no render)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "pub-placeholder", { viewerB: true });
  try {
    // A: the live's content (B must never stand it).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "the live secret");
    });
    await expect(a.locator('[data-slot="docblocks/page"]').first()).toContainText("the live secret", SETTLE);
    const bDoc = b.locator('[data-testid="doc-b"]');
    // The security's stand: the viewer's pane holds no doc at all (the
    // reader's browser stands nothing — not even the live's skeleton).
    expect(await b.evaluate(() => window.__paneDocs?.b)).toBeNull();
    // The placeholder's stand: the not-published's card, the live's content
    // stands no render.
    await expect(bDoc.locator('[data-slot="docblocks/not-published"]')).toBeVisible(SETTLE);
    await expect(bDoc).toContainText("This document has not been published yet.");
    await expect(bDoc.locator("text=the live secret")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the published's snapshot stands static over the live's edits (the reader stands no live's state)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "pub-static", { viewerB: true });
  try {
    // A: the published's content's publish.
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "v1 text");
    });
    await handoffPublished(a, b);
    const bDoc = b.locator('[data-testid="doc-b"]');
    await expect(bDoc.locator('[data-slot="docblocks/page"]').first()).toContainText("v1 text", SETTLE);
    // A: the live's edit (the new's text the reader must not stand).
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "v2 live text");
    });
    await expect(a.locator('[data-slot="docblocks/page"]').first()).toContainText("v2 live text", SETTLE);
    // B stands the published's state only (the snapshot is the static's
    // stand — the live's edit stands no render).
    await expect(bDoc).toContainText("v1 text");
    await expect(bDoc.locator("text=v2 live text")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the editor's published's switcher stands the snapshot (the read-only's stand + the snapshot's meta + the collapse's parity)", async ({
  browser,
}) => {
  const { a: page, close } = await twoPanes(browser, "pub-editor-switch");
  try {
    // A: the live's content (the title + the text's block over the empties'
    // chain) — the publish, then the live's title's edit (the meta's
    // divergence).
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.setTitle("PUBLISHED META");
      doc.insertBlock("paragraph");
      doc.insertBlock("paragraph");
      const id = doc.insertBlock("paragraph");
      doc.insertText(id, 0, "the snapshot text");
    });
    await expect(page.locator('[data-slot="docblocks/page"]').first()).toContainText("the snapshot text", SETTLE);
    // The edit's mode's rows' stand (the paragraphs' full's stand — the
    // starter's parity is independent: the count stands over the JSON's
    // blocks' stand, not the fixed's number).
    const json = await paneDocJson(page, "a");
    const paragraphs = Object.values(json.blocks).filter((block) => block.type === "paragraph");
    const rows = page.locator('[data-testid="doc-a"] [data-slot="docblocks/row"]');
    await expect(rows).toHaveCount(paragraphs.length, SETTLE);
    await page.getByTestId("publish-a").click();
    await page.evaluate(() => {
      const doc = window.__paneDocs?.a ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      doc.setTitle("LIVE META");
    });
    // The switch: the published's mode (the snapshot's subtree's stand).
    await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="Published"]').click();
    await expect(page.locator('[data-slot="docblocks/editor"]').first()).toHaveAttribute("data-readonly", "true");
    // The snapshot's content stands (the live's title's edit stands no
    // render — the header stands the snapshot's meta).
    await expect(page.locator('[data-testid="doc-a"] [data-slot="docblocks/page"]').first()).toContainText(
      "the snapshot text",
      SETTLE
    );
    await expect(page.locator('[data-slot="docblocks/doc-header-title"]')).toContainText("PUBLISHED META");
    // The empty chains' collapse's parity (the empties' chain stands the
    // one's row + the text's paragraph — the two rows; the starter's
    // parity is independent: the chain's stand is over the empties' count).
    await expect(rows).toHaveCount(2, SETTLE);
    // The switch back: the edit's stand returns (the live's content + the
    // live's meta, the full's rows' stand).
    await page.locator('[data-slot="docblocks/doc-header-mode"] button[aria-label="Edit mode"]').click();
    await expect(page.locator('[data-slot="docblocks/doc-header-title"]')).toContainText("LIVE META");
    await expect(page.locator('[data-slot="docblocks/editor"]').first()).not.toHaveAttribute("data-readonly");
    await expect(rows).toHaveCount(paragraphs.length, SETTLE);
  } finally {
    await close();
  }
});
