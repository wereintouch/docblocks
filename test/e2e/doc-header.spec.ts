// The consumer-placed document header panel's title (the inline edit): the
// edit commits one setTitle (one undo step) and syncs over the wire to the
// second pane (the caret's end seat, the Enter / the Escape / the blur, the
// empty + the no-op commits); the panel stands in the pane's chrome, so the
// editor's views are headerless (the composition's order stands). The
// avatar's ops stand over doc-header-avatar.spec.ts, the mode switcher over
// doc-header-mode.spec.ts. The mermaid mode switcher (the SegmentSelector it
// was refactored from) is pinned by its own spec (mermaid.spec.ts).
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

/** Commits a title through the panel's inline edit (click, fill, Enter). */
async function setDocTitle(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "Edit the document title" }).click();
  const input = page.getByRole("textbox", { name: "Document title" });
  await input.fill(title);
  await input.press("Enter");
}

/**
 * Commits an avatar through the panel's emoji popover (open, pick the option
 * by its accessible label). The popover closes on the pick.
 */
async function setDocAvatar(page: Page, emojiLabel: string): Promise<void> {
  await page.getByRole("button", { name: "Edit the document avatar" }).click();
  await page.getByRole("button", { name: emojiLabel }).click();
}

test("the title edit commits one setTitle and syncs to the second pane (the JSON and the panel)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "doc-header-title");
  try {
    await setDocTitle(a, "First doc");
    // Pane A's JSON meta reflects the title (the commit).
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("First doc");
    // Pane B's JSON and its panel stand the synced title (the wire).
    await expect.poll(() => metaOf(b, "b").then((m) => m.title), SETTLE).toBe("First doc");
    await expect
      .poll(() => b.getByRole("button", { name: "Edit the document title" }).innerText(), SETTLE)
      .toBe("First doc");
  } finally {
    await close();
  }
});

test("the title and the avatar edits are one undo step each (the undo reverts them)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-header-undo");
  try {
    await setDocTitle(a, "Original");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Original");
    // The single undo reverts the title (the Ctrl+Z's command path).
    await a.evaluate(() => {
      window.__paneDocs?.a?.undo();
    });
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("");

    await setDocAvatar(a, "Fox");
    await expect.poll(() => metaOf(a, "a").then((m) => m.avatar), SETTLE).toBe("🦊");
    // The single undo reverts the avatar (the clear stands absent).
    await a.evaluate(() => {
      window.__paneDocs?.a?.undo();
    });
    await expect.poll(() => metaOf(a, "a").then((m) => m.avatar), SETTLE).toBe("");
  } finally {
    await close();
  }
});

test("the document views are headerless (the panel is the pane's chrome, not the editor)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-header-headerless");
  try {
    const docArea = a.locator('[data-testid="doc-a"]');
    // The editor area stands no header panel (the panel is outside it).
    await expect(docArea.locator('[data-slot="docblocks/doc-header"]')).toHaveCount(0);
    // The pane's chrome stands the panel.
    await expect(a.locator('[data-slot="docblocks/doc-header"]')).toHaveCount(1);
  } finally {
    await close();
  }
});

test("the panel's composition stands the order (the switcher, the avatar, the title) and the Untitled placeholder", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-composition");
  try {
    // The order left to right: the view switcher, the avatar, the title.
    const order = await a.evaluate(() => {
      const header = document.querySelector('[data-slot="docblocks/doc-header"]');
      if (header === null) return null;
      const els = [
        header.querySelector('[data-slot="docblocks/doc-header-view"]'),
        header.querySelector('[data-slot="docblocks/doc-header-avatar"]'),
        header.querySelector('[data-slot="docblocks/doc-header-title"]'),
      ];
      const xs = els.map((el) => (el === null ? null : (el as HTMLElement).getBoundingClientRect().x));
      return xs.every((x) => x !== null) ? (xs as number[]) : null;
    });
    expect(order).not.toBeNull();
    expect(order).toEqual([...order!].sort((x, y) => x - y));
    // The absent title stands the "Untitled" placeholder.
    await expect(a.getByText("Untitled")).toBeVisible();
  } finally {
    await close();
  }
});

test("the title edit seats the caret at the end (no select-all); the Enter commits and blurs; the Escape reverts and blurs", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-title-caret");
  try {
    await setDocTitle(a, "Original title");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Original title");

    // The caret stands after the last character (a select-all would stand
    // the range 0..len — the selectionStart distinguishes the two).
    await a.getByRole("button", { name: "Edit the document title" }).click();
    const input = a.getByRole("textbox", { name: "Document title" });
    await expect.poll(async () => input.inputValue(), SETTLE).toBe("Original title");
    const selection = await a.evaluate(() =>
      document.activeElement instanceof HTMLInputElement
        ? { start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
        : null
    );
    expect(selection).toEqual({
      start: "Original title".length,
      end: "Original title".length,
    });

    // The Enter commits and blurs (the focus leaves the input).
    await input.press("Enter");
    await expect
      .poll(async () => a.evaluate(() => document.activeElement?.getAttribute("data-slot") ?? null), SETTLE)
      .not.toBe("docblocks/doc-header-title-edit");

    // The Escape reverts (no write) and blurs.
    await a.getByRole("button", { name: "Edit the document title" }).click();
    const input2 = a.getByRole("textbox", { name: "Document title" });
    await input2.fill("Changed");
    await input2.press("Escape");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Original title");
    await expect
      .poll(async () => a.evaluate(() => document.activeElement?.getAttribute("data-slot") ?? null), SETTLE)
      .not.toBe("docblocks/doc-header-title-edit");
  } finally {
    await close();
  }
});

test("the title edit's blur commits over the wire (the click-away)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "doc-header-title-blur");
  try {
    await a.getByRole("button", { name: "Edit the document title" }).click();
    const input = a.getByRole("textbox", { name: "Document title" });
    await input.fill("Blur committed");
    // The blur (the click on the view switcher) commits.
    await a.getByRole("button", { name: "Page view" }).click();
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Blur committed");
    await expect.poll(() => metaOf(b, "b").then((m) => m.title), SETTLE).toBe("Blur committed");
    await expect
      .poll(() => b.getByRole("button", { name: "Edit the document title" }).innerText(), SETTLE)
      .toBe("Blur committed");
  } finally {
    await close();
  }
});

test("the empty title commit stands the Untitled placeholder (the undo reverts)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-header-title-empty");
  try {
    await setDocTitle(a, "Gone");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Gone");
    // The empty-string commit (the cleared input, the Enter).
    await a.getByRole("button", { name: "Edit the document title" }).click();
    const input = a.getByRole("textbox", { name: "Document title" });
    await input.fill("");
    await input.press("Enter");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("");
    await expect(a.getByText("Untitled")).toBeVisible();
    await expect(a.getByText("Gone")).toHaveCount(0);
    // The undo reverts to "Gone".
    await a.evaluate(() => {
      window.__paneDocs?.a?.undo();
    });
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Gone");
  } finally {
    await close();
  }
});

test("the title edit's no-op commit (the unchanged value) stands no wire write and no undo step", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-noop");
  try {
    await setDocTitle(a, "Same");
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Same");
    // The no-op commit (the same value, the Enter).
    await a.getByRole("button", { name: "Edit the document title" }).click();
    const input = a.getByRole("textbox", { name: "Document title" });
    await input.press("Enter"); // the unchanged value
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("Same");
    // A single undo reverts the seed (the no-op added no step).
    await a.evaluate(() => {
      window.__paneDocs?.a?.undo();
    });
    await expect.poll(() => metaOf(a, "a").then((m) => m.title), SETTLE).toBe("");
    // A single undo reverts the seed (the no-op added no step): if the no-op
    // had written, this undo would be the no-op and the title would stand.
  } finally {
    await close();
  }
});
