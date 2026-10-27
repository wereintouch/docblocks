import { type Browser, type Page, expect, test } from "@playwright/test";

// The consumer-placed document header panel (the page/canvas switcher, the
// avatar, the title): the title / the avatar edit commit one command (one
// undo step) and sync over the wire to the second pane; the mode switcher
// drives the pane's editor view (the sliding pill); the panel stands in the
// pane's chrome, so the editor's views are headerless. The mermaid mode
// switcher (the SegmentSelector it was refactored from) is pinned by its
// own spec (mermaid.spec.ts).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
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

/** The pane's doc JSON (a stable string — the no-data-write pin). */
async function jsonOf(page: Page, client: "a" | "b"): Promise<string> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = client === "a" ? docs?.a : docs?.b;
      if (doc === null || doc === undefined) return "";
      return JSON.stringify(doc.toJSON());
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

/** Commits an avatar through the panel's inline edit (click, fill, Enter). */
async function setDocAvatar(page: Page, avatar: string): Promise<void> {
  await page.getByRole("button", { name: "Edit the document avatar" }).click();
  const input = page.getByRole("textbox", { name: "Document avatar" });
  await input.fill(avatar);
  await input.press("Enter");
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

test("the avatar edit commits one setAvatar and syncs to the second pane", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "doc-header-avatar");
  try {
    await setDocAvatar(a, "🦊");
    await expect.poll(() => metaOf(a, "a").then((m) => m.avatar), SETTLE).toBe("🦊");
    // Pane B's JSON and its panel stand the synced avatar.
    await expect.poll(() => metaOf(b, "b").then((m) => m.avatar), SETTLE).toBe("🦊");
    await expect.poll(() => b.getByRole("button", { name: "Edit the document avatar" }).innerText(), SETTLE).toBe("🦊");
  } finally {
    await close();
  }
});

test("the mode switcher drives the pane's editor view (the pill stands over the active mode)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "doc-header-view");
  try {
    const docArea = a.locator('[data-testid="doc-a"]');
    // The page view is the default: the page flows (no page miniature).
    await expect(docArea.locator('[data-slot="docblocks/page-card"]')).toHaveCount(0);
    // The panel's sliding pill stands (over the active page mode).
    await expect(a.locator('[data-slot="docblocks/doc-header-view-pill"]')).toBeVisible();
    await expect(a.locator('[data-doc-header-view-button="page"]')).toHaveAttribute("aria-pressed", "true");
    // Capture the doc's JSON (the switch is view state — it must not change it).
    const jsonBefore = await jsonOf(a, "a");
    // Switch to the canvas view: the editor's view changes (the page miniature stands).
    await a.getByRole("button", { name: "Canvas view" }).click();
    await expect(docArea.locator('[data-slot="docblocks/page-card"]')).toBeVisible();
    // The pill slides to the canvas mode (the active button flips).
    await expect(a.locator('[data-doc-header-view-button="canvas"]')).toHaveAttribute("aria-pressed", "true");
    // The switch is view state (no data write — the JSON is byte-identical).
    await expect.poll(() => jsonOf(a, "a"), SETTLE).toBe(jsonBefore);
  } finally {
    await close();
  }
});

test("the mode switcher's pill stands the soft-highlight token (the dark reads over the track's `muted`; the active icon stands the foreground)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "doc-header-pill-token");
  try {
    // The pill's background = a standard soft-highlight token (NOT `background`
    // — the former stand was the dark theme's near-black, darker than the
    // track's `muted` and "gloomy"): the light stands the `accent` token, the
    // dark stands the `ring` token (the neutral theme's `accent` == `muted` —
    // the track — so the `accent`'s pill blends with the track; the `ring`
    // reads over it). The active icon = the `foreground` token (it reads over
    // the pill — the token's own contrast, not a blend). Each token's stand
    // stands the theme's resolve (the consumer's theme or the fallback
    // literal) — both themes are checked.
    const pillInfo = (expectedToken: string) =>
      a.evaluate((tok) => {
        const pill = document.querySelector('[data-slot="docblocks/doc-header-view-pill"]');
        if (pill === null) return null;
        const pillBg = getComputedStyle(pill).backgroundColor;
        // A probe element resolves a token's computed color (the same resolve the
        // pill's `bg-accent` / `dark:bg-ring` / the icon's `text-foreground`
        // run through) — the comparison is theme-agnostic (no token-string
        // normalization).
        const probe = (val: string): string => {
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
        const expectedBg = probe(`var(${tok})`);
        const bgBg = probe("var(--background)");
        const mutedBg = probe("var(--muted)");
        const fgBg = probe("var(--foreground)");
        const activeBtn = document.querySelector('[data-slot="docblocks/doc-header-view"] [aria-pressed="true"]');
        return {
          pillBg,
          expectedBg,
          bgBg,
          mutedBg,
          activeColor: activeBtn !== null ? getComputedStyle(activeBtn).color : null,
          fgBg,
        };
      }, expectedToken);
    // The light's pill = the `accent`; the dark's pill = the `ring` (brighter
    // than the track's `muted` — the pill-blends-with-the-track guard,
    // the dark-only check). Both stand NOT the `background`.
    const themeTokens: [string, string][] = [
      ["light", "--accent"],
      ["dark", "--ring"],
    ];
    for (const [theme, token] of themeTokens) {
      await a.evaluate((t) => {
        if (t === "dark") document.documentElement.classList.add("dark");
        else document.documentElement.classList.remove("dark");
      }, theme);
      // Wait for the pill to stand the expected token (not the background / the
      // track) + the active icon to stand the foreground.
      await expect
        .poll(async () => {
          const info = await pillInfo(token);
          return (
            info !== null &&
            info.pillBg === info.expectedBg &&
            info.pillBg !== info.bgBg &&
            (theme === "light" || info.pillBg !== info.mutedBg) &&
            info.activeColor === info.fgBg
          );
        }, SETTLE)
        .toBe(true);
      const info = await pillInfo(token);
      expect(info?.pillBg).toBe(info?.expectedBg);
      expect(info?.pillBg).not.toBe(info?.bgBg);
      if (theme === "dark") expect(info?.pillBg).not.toBe(info?.mutedBg);
      expect(info?.activeColor).toBe(info?.fgBg);
    }
    // Regression: the switch still works (the pill slides over the active mode —
    // the past ticket's stand; the component's shared style, the same pill,
    // stands the mermaid's selector too — the one class).
    await a.getByRole("button", { name: "Canvas view" }).click();
    await expect(a.locator('[data-doc-header-view-button="canvas"]')).toHaveAttribute("aria-pressed", "true");
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

    await setDocAvatar(a, "🦊");
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
