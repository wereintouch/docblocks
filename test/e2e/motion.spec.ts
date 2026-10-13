import { type Browser, type Page, expect, test } from "@playwright/test";

import { insertBlockType } from "./helpers";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";
const SETTLE = { timeout: 15_000 };

async function openPane(page: Page, client: "a" | "b", room: string): Promise<void> {
  await page.goto(`/?client=${client}&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId(`status-${client}`)).toHaveText("connected", SETTLE);
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
 * Wait for pane A's entry height animations to settle. A drag started
 * mid-animation measures the entries' mid-flight boxes (the lift's height,
 * the siblings' crossing centers) and the live reorder misjudges. A
 * settled entry carries the animated `height: auto` inline (an entry that
 * skipped the enter animation carries none).
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

test("an inserted block reaches both panes and its enter animation settles", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-insert");

  // Both panes seed their own first paragraph, so the room starts with two.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);

  await insertBlockType(a, "a", "paragraph");

  // Both panes (the motion editor) render the block as it arrives...
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(3);
  // ...and the enter animation settles in A (the block is current after
  // the insert, so it is labeled).
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(3);
  await expect
    .poll(
      async () => await currentWrapper(a, "a").evaluate((el) => getComputedStyle(el.parentElement!).opacity),
      SETTLE
    )
    .toBe("1");
  await expect(currentWrapper(a, "a")).toBeVisible();

  await close();
});

test("an in-place line break reflows without a size projection (the text is never scaled)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03c-linebreak");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const content = wrappers(a, "a").nth(0).locator('[data-slot="docblocks/block-content"]');
  await content.click();
  await a.keyboard.type("hello");
  await a.keyboard.press("Shift+Enter");

  // The changed entry's content height grew in place, so that entry must
  // never carry a framer transform — it is the top entry, so its own height
  // change gives it no position delta, and a size projection (had one been
  // armed) would be mid-scale on it, distorting the text. Sample three
  // times over the first ~120 ms. The entries below it may carry a
  // transient zero-duration projection transform (the instant position
  // slide), so the window pin is scoped to the changed entry; the settle
  // assertion below still requires every entry to be clean.
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
    .toBe("none;none");

  await close();
});

test("a gutter drag slides the crossed entry into its slot (the layout animation runs)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03c-cross-slide");

  // Both panes seed their own first paragraph; the insert makes three
  // (the harness insert — no typing, deterministic under parallel load).
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const thirdId = await insertBlockType(a, "a", "paragraph");
  await settled(a);

  // A non-dragged entry's layout animation writes a non-identity inline
  // transform on its Reorder.Item (a group's direct child) while the slide
  // is in flight. Wait for it from the Node side (a 20 ms CDP poll — an
  // in-page rAF sampler is starved by the other spec's pages in a parallel
  // run). The dragged entry's lift pin is on the inner content div, and
  // its own gap slides too — so exclude the dragged child: the pin is the
  // crossed sibling's slide.
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

  // A real pointer drag of the third block's gutter handle up past the
  // second block's top (slow steps so the browser renders between moves
  // and the crossed entry's slide is in flight mid-drag).
  const handle = wrappers(a, "a").nth(2).locator('button[data-slot="docblocks/gutter"]');
  const handleBox = await handle.boundingBox();
  const secondBox = await wrappers(a, "a").nth(1).boundingBox();
  if (handleBox === null || secondBox === null) throw new Error("no handle/second boxes");
  const fromY = handleBox.y + handleBox.height / 2;
  const dy = fromY - (secondBox.y - 10);
  await a.mouse.move(handleBox.x, fromY);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(handleBox.x, fromY - (dy * i) / 12);
    await a.waitForTimeout(35);
  }
  await a.mouse.up();
  // The slide runs out (it started when the drag crossed mid-drag).
  await slid;

  // The drag committed: the dragged block is second now.
  const order = await wrappers(a, "a").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
  expect(order[1]).toBe(thirdId);

  await close();
});

test("a re-drag of the same entry stays pointer-locked (the lift transition does not leak)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ui03c-redrag");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const thirdId = await insertBlockType(a, "a", "paragraph");
  await settled(a);

  const handleCenter = async (index: number) => {
    const box = await wrappers(a, "a").nth(index).locator('button[data-slot="docblocks/gutter"]').boundingBox();
    if (box === null) throw new Error("no handle box");
    return { x: box.x, y: box.y + box.height / 2 };
  };

  // First drag: the third block to the second slot (one commit) — the
  // release settle writes its inline transform transition on this
  // entry's content.
  const from = await handleCenter(2);
  const secondBox = await wrappers(a, "a").nth(1).boundingBox();
  if (secondBox === null) throw new Error("no second box");
  await a.mouse.move(from.x, from.y);
  await a.mouse.down();
  for (let i = 1; i <= 12; i++) {
    await a.mouse.move(from.x, from.y - ((from.y - (secondBox.y - 8)) * i) / 12);
    await a.waitForTimeout(35);
  }
  await a.mouse.up();
  const order1 = await wrappers(a, "a").evaluateAll((els) => els.map((el) => el.getAttribute("data-block-id")));
  expect(order1[1]).toBe(thirdId);
  // The settle (220 ms) is done: the lift is dropped and the content is
  // back in the flow.
  await a.waitForTimeout(300);

  // Second drag of the same entry, no crossing (a no-op drop): after a
  // fast retarget the pointer is held still — the lifted content
  // (pointer-pinned, the pin writes carry no transition) must be
  // stationary: two samples 50 ms apart agree. A transition leaked from
  // the first release would still animate the pin's transform, so the
  // content chases the pointer between the samples. A crossing is kept
  // out of the window on purpose: a crossing commit moves the gap's
  // projected box a frame after the pin write (the one-frame hitch),
  // which would move the content regardless of the leak.
  const contentTop = () =>
    a.evaluate((id) => {
      const group = document.querySelector('[data-testid="doc-a"] [data-docblocks-motion] > div');
      const entry = Array.from(group?.children ?? []).find(
        (c) => c.querySelector("[data-block-id]")?.getAttribute("data-block-id") === id
      );
      const content = entry instanceof HTMLElement ? (entry.children[1] ?? entry.children[0]) : null;
      return content instanceof HTMLElement ? content.getBoundingClientRect().top : null;
    }, thirdId);

  const from2 = await handleCenter(1);
  await a.mouse.move(from2.x, from2.y);
  await a.mouse.down();
  for (let i = 1; i <= 2; i++) {
    await a.mouse.move(from2.x, from2.y + 4 * i);
    await a.waitForTimeout(35);
  }
  await a.mouse.move(from2.x, from2.y + 24);
  const t1 = await contentTop();
  await a.waitForTimeout(50);
  const t2 = await contentTop();
  await a.mouse.up();
  if (t1 === null || t2 === null) throw new Error("no content box");
  expect(Math.abs(t2 - t1)).toBeLessThan(2);

  await close();
});

test("a gutter deletion disappears in both panes (the exit animation completes)", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ui03c-delete");

  await expect(wrappers(a, "a"), SETTLE).toHaveCount(2);
  const before = 2;
  const wrapper = wrappers(a, "a").nth(1);
  const gutter = wrapper.locator('button[data-slot="docblocks/gutter"]');

  const wrapperId = (await wrapper.getAttribute("data-block-id")) ?? "";
  await wrapper.hover();
  await gutter.click();
  await expect(wrapper).toHaveAttribute("data-selected", "true");

  await a.keyboard.press("Delete");

  // The exit animation runs out (the leaving entry is popped out of the
  // layout) and the block is gone in both panes.
  await expect(wrappers(a, "a"), SETTLE).toHaveCount(before - 1);
  await expect(wrappers(b, "b"), SETTLE).toHaveCount(before - 1);
  await expect(b.getByTestId(`block-b-${wrapperId}`)).toHaveCount(0);

  await close();
});
