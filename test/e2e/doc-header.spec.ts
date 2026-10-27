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
    // than the track's `muted` — the owner's "the pill blends with the track"
    // stand, the dark-only check). Both stand NOT the `background`.
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
