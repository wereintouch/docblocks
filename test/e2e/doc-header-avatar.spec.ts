// The document header's avatar (the emoji popover): the pick commits one
// setAvatar (one undo step) and syncs over the wire to the second pane; the
// portaled popover's content stands the standard tokens.
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, twoPanes } from "./helpers";

/** The pane's doc meta (the harness global; the letter's doc on its own page). */
async function metaOf(page: Page, client: "a" | "b"): Promise<{ title: string; avatar: string }> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return { title: "", avatar: "" };
      return { title: doc.meta.title, avatar: doc.meta.avatar ?? "" };
    },
    { client }
  );
}

/**
 * Commits an avatar through the panel's emoji popover (open, pick the option
 * by its accessible label). The popover closes on the pick.
 */
async function setDocAvatar(page: Page, emojiLabel: string): Promise<void> {
  await page.getByRole("button", { name: "Edit the document avatar" }).click();
  await page.getByRole("button", { name: emojiLabel }).click();
}

/** Clears the avatar through the panel's emoji popover's clear option. */
async function clearDocAvatar(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit the document avatar" }).click();
  await page.getByRole("button", { name: "Remove avatar" }).click();
}

test("the avatar pick commits one setAvatar and syncs to the second pane (the popover closes on the pick)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-header-avatar");
  try {
    await setDocAvatar(a, "Fox");
    await expect.poll(() => metaOf(a, "a").then((m) => m.avatar), SETTLE).toBe("🦊");
    // The popover closed on the pick (the grid is gone).
    await expect(a.getByRole("button", { name: "Remove avatar" })).toHaveCount(0);
    // Pane B's JSON and its panel stand the synced avatar.
    await expect.poll(() => metaOf(b, "b").then((m) => m.avatar), SETTLE).toBe("🦊");
    await expect.poll(() => b.getByRole("button", { name: "Edit the document avatar" }).innerText(), SETTLE).toBe("🦊");
    // The clear option removes it (the dashed plus stand) and syncs.
    await clearDocAvatar(a);
    await expect.poll(() => metaOf(a, "a").then((m) => m.avatar), SETTLE).toBe("");
    await expect.poll(() => metaOf(b, "b").then((m) => m.avatar), SETTLE).toBe("");
    await expect.poll(() => a.getByRole("button", { name: "Edit the document avatar" }).innerText(), SETTLE).toBe("+");
  } finally {
    await close();
  }
});

test("the avatar popover's portaled content stands the standard tokens (the `--popover` background, not the `--docblocks-*`)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-avatar-tokens");
  try {
    await a.getByRole("button", { name: "Edit the document avatar" }).click();
    await expect(a.getByRole("button", { name: "Remove avatar" })).toBeVisible();
    // The portaled popover content's background resolves the standard
    // `--popover` token (the panel is outside the editor root, where the
    // `--docblocks-*` tokens are not mapped).
    const info = await a.evaluate(() => {
      const content = document.querySelector('[data-slot="popover-content"]');
      if (content === null) return null;
      const probe = (val: string) => {
        const el = document.createElement("div");
        el.style.backgroundColor = val;
        el.style.position = "absolute";
        el.style.width = "0";
        el.style.height = "0";
        document.body.appendChild(el);
        const c = getComputedStyle(el).backgroundColor;
        el.remove();
        return c;
      };
      return {
        bg: getComputedStyle(content).backgroundColor,
        expected: probe("var(--popover)"),
        // The popover content is portaled (a body-level surface, not nested
        // under the doc-header panel).
        portaled: !document.querySelector('[data-slot="docblocks/doc-header"]')?.contains(content),
      };
    });
    expect(info).not.toBeNull();
    expect(info!.bg).toBe(info!.expected);
    expect(info!.portaled).toBe(true);
  } finally {
    await close();
  }
});
