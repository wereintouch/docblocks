// The page's motion row layer — the enter's stand (an insert before any
// input stands up instantly; an insert after input runs the enter animation)
// and the line-break's in-place reflow (the changed row never carries a size
// projection — the text is never scaled).
import { type Page, expect, test } from "@playwright/test";

import { SETTLE, insertBlockType, twoPanes } from "./helpers";

function pane(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"]`);
}

/** The pane's block wrappers (the inner editables are not blocks). */
function wrappers(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-slot="docblocks/row"]');
}

/** The pane's current block wrapper (the harness labels it `data-current`). */
function currentWrapper(page: Page, client: "a" | "b") {
  return pane(page, client).locator('[data-block-id][data-current="true"]');
}

test("an insert before any input stands up instantly; an insert after input runs the enter animation", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "mid-document-insert");

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
  const { a, close } = await twoPanes(browser, "line-break-reflow");

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
