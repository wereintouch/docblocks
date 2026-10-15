import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected");
}

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id]:not([data-slot="docblocks/block-content"])');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

async function twoPanes(
  browser: Browser,
  room: string
): Promise<{
  a: Page;
  b: Page;
  close: () => Promise<void>;
}> {
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

/**
 * Wait for pane A's row height animations to settle. A drag started
 * mid-animation measures the rows' mid-flight boxes and the live reorder
 * misjudges. A settled row carries the animated `height: auto` inline (a
 * row that skipped the enter animation carries none).
 */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('[data-testid="doc-a"] [data-docblocks-motion] > div > *')).every(
        (el) => el instanceof HTMLElement && (el.style.height === "" || el.style.height === "auto")
      ),
    null,
    { polling: 20, timeout: 5_000 }
  );
}

test("an insert before any input stands up instantly; an insert after input runs the enter animation", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-insert");

  // The room starts with pane "a"'s single starter.
  await expect(wrappers(a, "a")).toHaveCount(1);

  // Capture the entering row's inline opacity at the mount tick (before
  // the first animation frame): a row that stands up instantly carries no
  // opacity-0 inline style (initial={false}: the animate values), a row
  // that runs the enter animation does (opacity 0 from the ENTER values).
  const armMountCapture = (page: Page) => (key: string) =>
    page.evaluate((k: string) => {
      const group = document.querySelector<HTMLElement>('[data-slot="docblocks/editor"] > div');
      (window as unknown as Record<string, { opacity: string | null }>)[k] = { opacity: null };
      if (group === null) return;
      const observer = new MutationObserver(() => {
        const entries = Array.from(group.children);
        const entry = entries[entries.length - 1] as HTMLElement | undefined;
        (window as unknown as Record<string, { opacity: string | null }>)[k]!.opacity =
          entry === undefined ? "absent" : entry.style.opacity;
        observer.disconnect();
      });
      observer.observe(group, { childList: true });
    }, key);
  const readMountCapture = (page: Page, key: string) =>
    page.evaluate((k: string) => (window as unknown as Record<string, { opacity: string | null }>)[k], key);

  // The first insert happens before either pane typed — both gates stand
  // closed, so the sync load (B) and the pre-input insert (A) stand up
  // instantly.
  await armMountCapture(b)("__mountB");
  await armMountCapture(a)("__mountA");

  await insertBlockType(a, "a", "paragraph");

  // Both panes (the motion editor) render the block as it arrives...
  await expect(wrappers(b, "b")).toHaveCount(2);
  // ...and the row is visible and settled in A (the block is current after
  // the insert, so it is labeled).
  await expect(wrappers(a, "a")).toHaveCount(2);
  await expect
    .poll(
      async () => await currentWrapper(a, "a").evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      SETTLE
    )
    .toBe("1");
  await expect(currentWrapper(a, "a")).toBeVisible();

  // The captured mount-tick opacity proves the stand-up was instant in
  // both panes (a sync load and a pre-input insert are not animated
  // inserts).
  const bMount = await readMountCapture(b, "__mountB");
  expect(bMount?.opacity).not.toBeNull();
  expect(bMount?.opacity).not.toBe("absent");
  expect(bMount?.opacity).not.toBe("0");
  const aMount = await readMountCapture(a, "__mountA");
  expect(aMount?.opacity).not.toBeNull();
  expect(aMount?.opacity).not.toBe("absent");
  expect(aMount?.opacity).not.toBe("0");

  // An insert after an input: the gate stands open in A (it types) — a
  // genuine insert runs the enter animation (opacity 0 at the mount tick,
  // settling at 1).
  await a.locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.type("hi");
  await armMountCapture(a)("__mountA2");
  await insertBlockType(a, "a", "paragraph");
  await expect(wrappers(a, "a")).toHaveCount(3);
  const aMount2 = await readMountCapture(a, "__mountA2");
  expect(aMount2?.opacity).toBe("0");
  await expect
    .poll(
      async () => await currentWrapper(a, "a").evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      SETTLE
    )
    .toBe("1");

  await close();
});

test("an in-place line break reflows without a size projection (the text is never scaled)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03c-linebreak");

  await expect(wrappers(a, "a")).toHaveCount(1);
  const content = wrappers(a, "a").nth(0).locator('[data-slot="docblocks/block-content"]');
  await content.click();
  await a.keyboard.type("hello");
  await a.keyboard.press("Shift+Enter");

  // The changed row's content height grew in place, so that row must never
  // carry a framer transform — it is the top row, so its own height change
  // gives it no position delta, and a size projection (had one been armed)
  // would be mid-scale on it, distorting the text. Sample three times over
  // the first ~120 ms. The rows below it may carry a transient
  // zero-duration projection transform (the instant position slide), so the
  // window pin is scoped to the changed row; the settle assertion below
  // still requires every row to be clean.
  const changedTransform = () =>
    pane(a, "a").evaluate((root) => {
      const group = root.querySelector("[data-docblocks-motion] > div");
      if (group === null) return null;
      const changed = group.children[0];
      return changed instanceof HTMLElement ? changed.style.transform : null;
    });
  const midTransforms: string[] = [];
  for (let i = 0; i < 3; i++) {
    const t = await changedTransform();
    expect(t).not.toBeNull();
    midTransforms.push(t!);
    if (i < 2) await a.waitForTimeout(60);
  }
  // `none` / the identity matrix: an active projection would carry a scale
  // or an offset here.
  expect(midTransforms.every((t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)")).toBe(true);

  // The break landed in the doc (a newline in the run text, not a new
  // block) and settled clean (no projection left armed behind).
  const text = await a.evaluate(
    (id) => {
      const block = window.__paneDocs?.a?.getBlock(id);
      return block?.content?.map((r) => r.text).join("") ?? null;
    },
    (await wrappers(a, "a").nth(0).getAttribute("data-block-id")) ?? ""
  );
  expect(text).toBe("hello\n");
  await expect
    .poll(
      async () =>
        await pane(a, "a").evaluate((root) => {
          const group = root.querySelector("[data-docblocks-motion] > div");
          if (group === null) return "no-group";
          return Array.from(group.children)
            .filter((c) => c instanceof HTMLElement)
            .map((el) => el.style.transform)
            .join(";");
        }),
      SETTLE
    )
    // The single starter row: one clean transform.
    .toBe("none");

  await close();
});

test("a real-pointer gutter drag slides the crossed sibling, commits over the wire, and undoes as one step", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-drag");

  // The room's starter; the insert makes two
  // (the harness insert — no typing, deterministic under parallel load).
  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  const thirdId = await insertBlockType(a, "a", "paragraph");
  await settled(a);

  // A non-dragged row's layout animation writes a non-identity inline
  // transform on its Reorder.Item (a group's direct child) while the slide
  // is in flight. Wait for it from the Node side (a 20 ms CDP poll — an
  // in-page rAF sampler is starved by the other spec's pages in a parallel
  // run). The dragged row carries its own projection too — so exclude it:
  // the pin is the crossed sibling's slide.
  const slid = a.waitForFunction(
    (draggedId) => {
      const group = document.querySelector('[data-testid="doc-a"] [data-docblocks-motion] > div');
      if (group === null) return false;
      return Array.from(group.children).some(
        (c) =>
          c instanceof HTMLElement &&
          c.querySelector("[data-block-id]")?.getAttribute("data-block-id") !== draggedId &&
          c.style.transform !== "" &&
          c.style.transform !== "none" &&
          c.style.transform !== "matrix(1, 0, 0, 1, 0, 0)"
      );
    },
    thirdId,
    { polling: 20, timeout: 5_000 }
  );

  // A real pointer drag of the third row's gutter handle above the first
  // row's top (slow steps so the browser renders between moves and the
  // crossed row's slide is in flight mid-drag). The pointer stops well
  // above the first row's center, so the commit's virtual index is 0
  // unambiguously (framer decides off the dragged row's projected position,
  // which tracks the pointer).
  const handle = wrappers(a, "a").nth(2).locator('button[data-slot="docblocks/gutter"]');
  const handleBox = await handle.boundingBox();
  const firstBox = await wrappers(a, "a").nth(0).boundingBox();
  if (handleBox === null || firstBox === null) throw new Error("no handle/first boxes");
  const fromY = handleBox.y + handleBox.height / 2;
  const dy = fromY - (firstBox.y - 10);
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(handleBox.x, fromY - (dy * i) / 12);
    await a.waitForTimeout(35);
  }
  await a.mouse.up();
  // The slide runs out (it started when the drag crossed mid-drag).
  await slid;

  // The drag committed: the dragged block is first now, in both panes
  // (the commit left the pane over the wire).
  const order = await wrappers(a, "a").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
  expect(order[0]).toBe(thirdId);
  await expect(wrappers(b, "b").nth(0)).toHaveAttribute("data-block-id", thirdId);

  // The move is A's local undo entry (one command, one undoable unit):
  // the order reverts in both panes. The undo hotkey reaches the doc only
  // from inside the editor root, so click back in first (the drag left the
  // focus outside).
  await wrappers(a, "a").nth(0).locator('[data-slot="docblocks/block-content"]').first().click();
  await a.keyboard.press("Control+z");
  await expect(wrappers(a, "a").nth(0)).not.toHaveAttribute("data-block-id", thirdId);
  await expect(wrappers(b, "b").nth(0)).not.toHaveAttribute("data-block-id", thirdId);

  await close();
});

test("a gutter deletion disappears in both panes (the exit animation completes)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-delete");

  await expect(wrappers(a, "a")).toHaveCount(1);
  await insertBlockType(a, "a", "paragraph");
  await expect(wrappers(a, "a")).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");

  // The exit animation runs out (the leaving row stays in the layout flow
  // and collapses) and the block is gone in both panes.
  await expect(wrappers(a, "a")).toHaveCount(before - 1);
  await expect(wrappers(b, "b")).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});
