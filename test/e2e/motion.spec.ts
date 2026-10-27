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
      Array.from(document.querySelectorAll('[data-testid="doc-a"] [data-slot="docblocks/rows"] > *')).every(
        (el) => el instanceof HTMLElement && (el.style.height === "" || el.style.height === "auto")
      ),
    null,
    { polling: 20, timeout: 5_000 }
  );
}

interface CaretBoundsSample {
  t: number;
  ceBottom: number | null;
  containerBottom: number | null;
  rows: number;
}

/**
 * Sample the last row's content box against the rows' box over the exit
 * window (a Node-side loop — an in-page rAF sampler is starved by the
 * other specs' pages in a parallel run). The invariant the pin keeps:
 * the caret row's content box never stands below the rows' bottom edge
 * (the document's bounds) — a lagging position projection pokes it out
 * over the slide's duration.
 */
async function sampleCaretBounds(page: Page, ms: number): Promise<CaretBoundsSample[]> {
  const samples: CaretBoundsSample[] = [];
  const start = Date.now();
  while (Date.now() - start < ms) {
    const s = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-slot="docblocks/row"]');
      const last = rows[rows.length - 1] as HTMLElement | undefined;
      const ce = last?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
      const group = document.querySelector<HTMLElement>('[data-slot="docblocks/rows"]');
      return {
        ceBottom: ce !== null ? Math.round(ce.getBoundingClientRect().bottom * 10) / 10 : null,
        containerBottom: group !== null ? Math.round(group.getBoundingClientRect().bottom * 10) / 10 : null,
        rows: rows.length,
      };
    });
    samples.push({ t: Date.now() - start, ...s });
    await page.waitForTimeout(25);
  }
  return samples;
}

/** The caret's final seat in pane A (the selection's anchor host + offset, the focus, the placeholder's content). */
async function caretSeat(page: Page): Promise<{
  anchorBlockId: string | null;
  anchorOffset: number;
  activeIsLastCe: boolean;
  placeholder: string | null;
  rowCount: number;
}> {
  return page.evaluate(() => {
    const sel = window.getSelection();
    const node = sel === null ? null : sel.anchorNode;
    const host = node instanceof Element ? node : (node?.parentElement ?? null);
    const ce = host?.closest<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    const rows = document.querySelectorAll('[data-slot="docblocks/row"]');
    const lastRow = rows[rows.length - 1] as HTMLElement | undefined;
    const lastCe = lastRow?.querySelector<HTMLElement>('[data-slot="docblocks/block-content"]') ?? null;
    return {
      anchorBlockId: ce?.dataset.blockId ?? null,
      anchorOffset: sel === null ? -1 : sel.anchorOffset,
      activeIsLastCe: document.activeElement === lastCe,
      placeholder: lastCe !== null ? getComputedStyle(lastCe, "::before").content : null,
      rowCount: rows.length,
    };
  });
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
      const group = document.querySelector<HTMLElement>('[data-slot="docblocks/rows"]');
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
      const group = root.querySelector('[data-slot="docblocks/rows"]');
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
          const group = root.querySelector('[data-slot="docblocks/rows"]');
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
      const group = document.querySelector('[data-testid="doc-a"] [data-slot="docblocks/rows"]');
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

test("a mid-document insert animates only the new row (existing rows never restart the enter animation)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui03c-insert-restart");
  try {
    // Three paragraphs, and an open enter-animation gate (A types).
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("one");
    await insertBlockType(a, "a", "paragraph");
    await currentWrapper(a, "a").locator('[data-slot="docblocks/block-content"]').first().click();
    await a.keyboard.type("two");
    await expect(wrappers(a, "a")).toHaveCount(3);
    await settled(a);

    // Watch every existing row's style attribute: the contract is that none
    // of them ever stands a numeric (mid-animation) height while the new
    // row runs its enter — a restarted enter would write the height values
    // from the ENTER geometry (a collapse and regrowth).
    const watchIds = await a.evaluate(() => {
      const rows = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="doc-a"] [data-slot="docblocks/row"]')
      );
      const seen: Record<string, string[]> = {};
      (window as unknown as { __restartWatch: unknown }).__restartWatch = { seen, stop: null as null | (() => void) };
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type !== "attributes" || record.attributeName !== "style") continue;
          const row = record.target as HTMLElement;
          const key = row.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? "?";
          const height = row.style.height;
          if (height !== "" && height !== "auto") {
            (seen[key] ??= []).push(height);
          }
        }
      });
      for (const row of rows) observer.observe(row, { attributes: true, attributeFilter: ["style"] });
      (window as unknown as { __restartWatch: { stop: null | (() => void) } }).__restartWatch.stop = () =>
        observer.disconnect();
      return rows.map((row) => row.querySelector<HTMLElement>("[data-block-id]")?.getAttribute("data-block-id") ?? "?");
    });
    expect(watchIds).toHaveLength(3);

    // The insert (mid-document, after the second row).
    await a.evaluate((afterId) => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.insertBlock("paragraph", undefined, { parent: doc.meta.id, after: afterId });
    }, watchIds[1]);
    await expect(wrappers(a, "a")).toHaveCount(4);
    await settled(a);

    // No existing row ran a height animation: the recorded numeric heights
    // are absent (the new row's own enter animation is out of scope — it
    // was not under observation).
    const numericHeights = await a.evaluate(() => {
      const watch = (window as unknown as { __restartWatch: { seen: Record<string, string[]>; stop: () => void } })
        .__restartWatch;
      watch.stop();
      return watch.seen;
    });
    expect(Object.values(numericHeights).flat()).toEqual([]);
  } finally {
    await close();
  }
});

test("a deletion above the caret stands the caret inside the document's bounds over the exit (the short doc)", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui03c-caretbounds");
  try {
    // [starter ∅][divider][∅ (the caret's block)]: the Backspace deletes
    // the divider (the non-content previous — the empty last block stands)
    // and the document's box shrinks to the final stand. A lagging position
    // projection would keep the caret row (the live caret + the
    // placeholder's line) below the new bottom edge over the slide.
    await expect(wrappers(a, "a")).toHaveCount(1);
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        doc.insertBlock("divider");
        doc.insertBlock("paragraph");
      });
    });
    await expect(wrappers(a, "a")).toHaveCount(3);
    await settled(a);
    const survivorId = (await wrappers(a, "a").nth(2).getAttribute("data-block-id")) ?? "";

    // The caret in the last empty block (the survivor).
    await wrappers(a, "a").nth(2).locator('[data-slot="docblocks/block-content"]').click();

    await a.keyboard.press("Backspace");
    const samples = await sampleCaretBounds(a, 450);

    // The pin stands over the exit's mid-slide (the 0.18 s window): the
    // leaving row still stands mounted (rows === 3) and the slide has
    // passed its first frames (t >= 100 — the projection's one-frame
    // settle stands out of the window; a lagging projection would stand
    // the caret row below the edge over the whole slide).
    const mid = samples.filter((s) => s.t >= 100 && s.rows === 3);
    // Non-vacuous: the exit stood in flight over the window.
    expect(mid.length).toBeGreaterThan(0);
    const violations = mid.filter(
      (s) => s.ceBottom !== null && s.containerBottom !== null && s.ceBottom > s.containerBottom + 2
    );
    expect(violations).toEqual([]);

    // The final seat (the re-seat's contract): the caret stands in the
    // survivor at its start, the focus stands on it, and the placeholder
    // stands over the empty line (the regression).
    const seat = await caretSeat(a);
    expect(seat.rowCount).toBe(2);
    expect(seat.anchorBlockId).toBe(survivorId);
    expect(seat.anchorOffset).toBe(0);
    expect(seat.activeIsLastCe).toBe(true);
    expect(seat.placeholder).toContain("Type '/' for commands");

    await close();
  } finally {
    await close();
  }
});

test("a deletion above the caret over the tall doc stands the bounds and the scroll stands no jump", async ({
  browser,
}) => {
  const { a, close } = await twoPanes(browser, "ui03c-caretbounds-tall");
  try {
    // A doc taller than the viewport (the window's scroll): the text's run
    // + a tall table + the caret's empty last block. The Backspace deletes
    // the table (the non-content previous) — the big reflow over the
    // scrolled viewport: the caret stands inside the document's bounds
    // over the exit and the scroll position stands the reflow's bound (no
    // jump beyond the deletion's own height).
    await expect(wrappers(a, "a")).toHaveCount(1);
    await a.evaluate(() => {
      const doc = window.__paneDocs?.a;
      if (doc === null || doc === undefined) throw new Error("the pane's doc is not mounted");
      doc.transact(() => {
        for (let i = 0; i < 12; i++) {
          const id = doc.insertBlock("paragraph");
          doc.insertText(id, 0, `line ${i}`);
        }
        const tableId = doc.insertBlock("table", { cols: 2 });
        for (let i = 0; i < 20; i++) {
          const row = doc.insertBlock("table-row", undefined, { parent: tableId });
          for (let j = 0; j < 2; j++) {
            const cell = doc.insertBlock("table-cell", undefined, { parent: row });
            doc.insertText(cell, 0, `r${i}c${j}`);
          }
        }
        doc.insertBlock("paragraph"); // the caret's block (the last)
      });
    });
    await expect(a.locator('[data-slot="docblocks/row"]')).toHaveCount(15);
    await settled(a);
    const lastRow = a.locator('[data-slot="docblocks/row"]').last();
    const survivorId = (await lastRow.locator(':scope > [data-block-id]').first().getAttribute("data-block-id")) ?? "";
    const tableBox = await a.locator('[data-block-type="table"]').first().boundingBox();
    const tableHeight = tableBox === null ? 0 : tableBox.height;
    expect(tableHeight).toBeGreaterThan(0);

    // The caret in the last empty block (the pane scrolls the block into
    // view over the click).
    await lastRow.locator('[data-slot="docblocks/block-content"]').last().click();
    const scrollBefore = await a.evaluate(() => window.scrollY);

    await a.keyboard.press("Backspace");
    const samples = await sampleCaretBounds(a, 450);

    // The pin stands over the exit's mid-slide (the 0.18 s window): the
    // table still stands mounted (rows === 15) and the slide has passed its
    // first frames (t >= 100 — the projection's one-frame settle stands out
    // of the window; a lagging projection would stand the caret row below
    // the edge over the whole slide).
    const mid = samples.filter((s) => s.t >= 100 && s.rows === 15);
    // Non-vacuous: the exit stood in flight over the window.
    expect(mid.length).toBeGreaterThan(0);
    const violations = mid.filter(
      (s) => s.ceBottom !== null && s.containerBottom !== null && s.ceBottom > s.containerBottom + 2
    );
    expect(violations).toEqual([]);

    // The scroll stands the reflow's bound (the deletion's own height —
    // the browser's scroll anchoring may re-seat it within it; a phantom
    // jump over the lagging projection would stand beyond).
    const scrollAfter = await a.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThanOrEqual(tableHeight + 4);

    // The final seat (the same contract as the short doc's pin).
    const seat = await caretSeat(a);
    expect(seat.rowCount).toBe(14);
    expect(seat.anchorBlockId).toBe(survivorId);
    expect(seat.anchorOffset).toBe(0);
    expect(seat.activeIsLastCe).toBe(true);
    expect(seat.placeholder).toContain("Type '/' for commands");

    await close();
  } finally {
    await close();
  }
});
