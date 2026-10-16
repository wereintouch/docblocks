import { type Browser, type Page, expect, test } from "@playwright/test";

const RELAY = "ws://localhost:5199";

/**
 * The "/" slash command menu (the reworked model): the "/" is regular doc
 * text — the keypress commits it through the command API (the browser's
 * insertion stands suppressed), and the query typed after it is plain text
 * (the doc is the source of truth; the filter is the suffix after the
 * triggering "/" up to the first whitespace). The menu stands at the "/"
 * character (below the line; above it when the below placement overruns
 * the viewport), zero matches hide the list (deleting back brings it),
 * Esc keeps the phrase in the text (the existing "/" never re-triggers —
 * only a "/" keypress does), and a picked command converts the block's
 * type with the rest of the text surviving (the trigger phrase is
 * stripped). The trigger stands at any position and indent of a page text
 * block; code and latex are excluded (a "/" there is plain text).
 */

/**
 * A unique room per test: the relay keeps rooms for the dev server's
 * lifetime, so a fixed name would accumulate the content of failed attempts
 * across runs.
 */
async function openPanes(browser: Browser, seed: string): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const room = `${seed}-${Math.random().toString(36).slice(2, 8)}`;
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  await a.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  await b.goto(`/?client=b&syncUrl=${RELAY}/${room}`);
  await expect(b.getByTestId("status-b")).toHaveText("connected");
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

function inner(page: Page, client: "a" | "b") {
  return page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/block-content"]`).first();
}

function menu(page: Page) {
  return page.locator('[data-slot="docblocks/slash-menu"]');
}

/** The pane's wire-log outbound doc-update count (awareness frames are not logged). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/** The rect of the block's "/" character (the flat offset `slashOffset` of its logical text; null when the pane or text node is missing). The optional `blockId` scopes the read (the default is the pane's first block). */
async function slashRect(
  page: Page,
  client: "a" | "b",
  slashOffset: number,
  blockId?: string
): Promise<{ left: number; bottom: number; top: number } | null> {
  return page.evaluate(
    ([c, offset, bid]) => {
      const scope =
        bid === undefined
          ? document.querySelector(`[data-testid="doc-${c}"]`)
          : document.querySelector(`[data-testid="doc-${c}"] [data-block-id="${bid}"]`);
      const innerEl = scope?.querySelector('[data-slot="docblocks/block-content"]');
      if (innerEl === null || innerEl === undefined) return null;
      const textNode = Array.from(innerEl.childNodes).find((n) => n.nodeType === Node.TEXT_NODE) as Text | undefined;
      if (textNode === undefined || offset >= textNode.length) return null;
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, offset + 1);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, bottom: rect.bottom, top: rect.top };
    },
    [client, slashOffset, blockId] as const
  );
}

test("the / is a plain doc character — the doc and the wire see it; Backspace deletes it", async ({ browser }) => {
  const { a, b, close } = await openPanes(browser, "ux01-slash-s1");
  const target = inner(a, "a");
  await target.click();
  const outBefore = await outCount(a, "a");

  await a.keyboard.press("/");
  // The menu stands open and the character is in the doc (both panes — the
  // sync is plain text).
  await expect(menu(a)).toBeVisible();
  await expect(target).toHaveText("/");
  await expect(inner(b, "b")).toHaveText("/");
  expect(await outCount(a, "a")).toBe(outBefore + 1);

  // Backspace deletes the "/" like any other character: the anchor vanishes
  // and the menu closes.
  await a.keyboard.press("Backspace");
  await expect(menu(a)).toHaveCount(0);
  await expect(target).toHaveText("");
  await expect(inner(b, "b")).toHaveText("");
  expect(await outCount(a, "a")).toBe(outBefore + 2);
  await close();
});

test("the menu stands at the / — below the line at the character's left edge", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux02-slash-anchor");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("ab/");
  await expect(menu(a)).toBeVisible();

  // The anchor is the "/" character itself (offset 2), not the block's
  // corner: the menu's top-left stands at the character's left edge, below
  // its line.
  const rect = await slashRect(a, "a", 2);
  const box = await menu(a).boundingBox();
  expect(rect).not.toBeNull();
  expect(box).not.toBeNull();
  if (rect !== null && box !== null) {
    expect(Math.abs(box.x - rect.left)).toBeLessThanOrEqual(4);
    expect(Math.abs(box.y - rect.bottom)).toBeLessThanOrEqual(4);
  }
  await close();
});

test("the menu flips above the line when the below placement does not fit (the bounded list scrolls)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "ux03-slash-flip");

  // A tall page: the last block sits at the viewport's bottom once scrolled.
  const lastId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    let id = "";
    doc.transact(() => {
      for (let i = 0; i < 24; i += 1) id = doc.insertBlock("paragraph");
    });
    return id;
  });
  expect(lastId).not.toBeNull();
  const blockInner = a.locator(`[data-block-id="${lastId}"] [data-slot="docblocks/block-content"]`);
  await blockInner.evaluate((el) => el.scrollIntoView({ block: "end" }));
  await blockInner.click();

  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();

  // The below placement would overrun the viewport bottom: the menu's
  // bottom stands at the "/" character's top (above the line), bounded
  // by the list's max height (the flip stays close to the caret).
  const rect = await slashRect(a, "a", 0, lastId!);
  const box = await menu(a).boundingBox();
  expect(rect).not.toBeNull();
  expect(box).not.toBeNull();
  if (rect !== null && box !== null) {
    expect(Math.abs(box.y + box.height - rect.top)).toBeLessThanOrEqual(4);
    expect(box.height).toBeLessThanOrEqual(324);
  }
  const scroll = await menu(a).evaluate((el) => ({ scrollable: el.scrollHeight > el.clientHeight }));
  expect(scroll.scrollable).toBe(true);
  await close();
});

test("the menu open does not scroll the page (the unpositioned first frame must not pull it)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux06-slash-no-scroll");

  // A tall page; the caret at the middle (the below placement).
  const midId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    let id = "";
    doc.transact(() => {
      for (let i = 0; i < 40; i += 1) id = doc.insertBlock("paragraph");
    });
    const ids = doc.getChildren(doc.meta.id);
    return ids[15];
  });
  expect(midId).not.toBeNull();
  const blockInner = a.locator(`[data-block-id="${midId}"] [data-slot="docblocks/block-content"]`);
  await blockInner.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await blockInner.click();
  const scrollBefore = await a.evaluate(() => window.scrollY);

  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();
  expect(await a.evaluate(() => window.scrollY)).toBe(scrollBefore);
  // Keyboard navigation scrolls the menu's own overflow, still not the page.
  for (let i = 0; i < 11; i += 1) await a.keyboard.press("ArrowDown");
  expect(await a.evaluate(() => window.scrollY)).toBe(scrollBefore);
  await close();
});

test("a divider landing at the document end gets a trailing empty paragraph (the caret stands there)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "ux04-slash-divider-end");
  const target = inner(a, "a");
  await target.click();

  // The starter paragraph is phrase-only: the Divider command replaces
  // it — the divider lands at the sequence's end.
  await a.keyboard.type("/divider");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Enter");

  // A trailing empty paragraph stands after the divider (the divider is
  // not editable — without it there is no way to keep typing), and the
  // caret stands in it (typing continues in the trailing block).
  const types = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    return doc.getChildren(doc.meta.id).map((id) => doc.getBlock(id)?.type ?? null);
  });
  expect(types).toEqual(["divider", "paragraph"]);
  // The caret seats in the trailing paragraph in the next frame (the
  // post-apply focus move) — wait for it before typing.
  await a.waitForFunction(() => {
    const ae = document.activeElement;
    return ae instanceof HTMLElement && ae.getAttribute("data-slot") === "docblocks/block-content";
  });
  await a.keyboard.type("hello");
  const text = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    const ids = doc.getChildren(doc.meta.id);
    return doc.getText(ids[ids.length - 1]!);
  });
  expect(text).toBe("hello");
  await close();
});

test("a trailing divider deletes through its row's gutter (the blocks selection's Delete)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux05-slash-divider-delete");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("/divider");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Enter");

  const divId = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    for (const id of doc.getChildren(doc.meta.id)) {
      if (doc.getBlock(id)?.type === "divider") return id;
    }
    return null;
  });
  expect(divId).not.toBeNull();

  // The motion view's row-level gutter stands for the non-text rows: the
  // gutter click selects the block (the row takes the focus — the editor
  // root owns the selection keys), Delete removes the divider.
  const row = a.locator('[data-slot="docblocks/row"]').filter({ has: a.locator('[data-slot="docblocks/divider"]') });
  await row.locator('[data-slot="docblocks/gutter"]').click();
  await expect(row).toHaveAttribute("data-selected", "true");
  await a.keyboard.press("Delete");

  // The divider is gone; the trailing paragraph stands.
  const types = await a.evaluate(() => {
    const doc = window.__paneDocs?.a ?? null;
    if (doc === null) return null;
    return doc.getChildren(doc.meta.id).map((id) => doc.getBlock(id)?.type ?? null);
  });
  expect(types).toEqual(["paragraph"]);
  await close();
});

test("the query filters; zero matches hide the list; deleting back brings it (the focus stays in the block)", async ({
  browser,
}) => {
  const { a, close } = await openPanes(browser, "ux04-slash-filter");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/hea");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(3);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText(["Heading 1", "Heading 2", "Heading 3"]);
  await expect(target).toBeFocused();

  // Zero matches: the list disappears (no placeholder).
  await a.keyboard.type("zz");
  await expect(menu(a)).toHaveCount(0);
  await expect(target).toBeFocused();
  await expect(target).toHaveText("/heazz");

  // Deleting back to a match brings the list (the state never closed — the
  // doc is the source of truth).
  await a.keyboard.press("Backspace");
  await a.keyboard.press("Backspace");
  await expect(target).toHaveText("/hea");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(3);
  await expect(target).toBeFocused();
  await close();
});

test("Esc keeps the phrase in the text; the existing / never re-triggers; a new / does", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux05-slash-esc");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/head");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("Escape");
  await expect(menu(a)).toHaveCount(0);
  // The phrase stands in the doc as plain text (the block is editable as usual).
  await expect(target).toHaveText("/head");
  await expect(target).toBeFocused();

  // Moving the caret back to the same "/" (no new "/" keypress) does not
  // re-open the menu.
  await a.keyboard.press("Home");
  await a.keyboard.press("ArrowRight");
  await a.keyboard.press("ArrowRight");
  await expect(menu(a)).toHaveCount(0);

  // A freshly typed "/" is a new trigger.
  await a.keyboard.press("End");
  await a.keyboard.press("/");
  await expect(menu(a)).toBeVisible();
  await expect(target).toHaveText("/head/");
  await close();
});

test("/ triggers in a non-empty, indented block; the apply converts the type and keeps the text", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux06-slash-convert");
  const target = inner(a, "a");
  await target.click();
  // Two blocks (the sequence head stays at indent 0 — the first block
  // cannot indent); the caret is re-seated in the second block explicitly
  // (the split's caret handoff settles with the motion view's animation).
  await a.keyboard.type("top");
  await a.keyboard.press("Enter");
  const second = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').nth(1);
  await expect(second).toHaveCount(1);
  await second.click();
  await a.keyboard.type("todo");
  await a.keyboard.press("Tab"); // the second block indents to level 1

  await a.keyboard.type("/task");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText("Task list");

  const outBefore = await outCount(a, "a");
  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);

  // The block converted in place: a task list item at its indent, the text
  // surviving (the trigger phrase "/task" stripped).
  const taskItem = a.locator('[data-block-type="list-item"]');
  await expect(taskItem).toHaveCount(1);
  await expect(taskItem.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo");
  const attrs = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const order = doc.getChildren(doc.toJSON().id);
    const id = order.find((blockId) => doc.getBlock(blockId)?.type === "list-item") ?? null;
    return id === null ? null : (doc.getBlock(id)?.attrs ?? null);
  }, "a");
  expect(attrs).toEqual({ list: "task", indent: 1 });

  // One command: one wire update; the other pane stands the same.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  const bItem = b.locator('[data-block-type="list-item"]');
  await expect(bItem).toHaveCount(1);
  await expect(bItem.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo");

  // One undo step: the phrase and the type are restored together (the
  // wire log lags the update — polled).
  await a.keyboard.press("Control+z");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 2);
  await expect(a.locator('[data-block-type="list-item"]')).toHaveCount(0);
  const restored = a.locator('[data-block-type="paragraph"]').filter({ hasText: "todo/task" });
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('[data-slot="docblocks/block-content"]')).toHaveText("todo/task");
  await close();
});

test("a phrase-only block converts by replacement (the converted block stands empty, the v1 path)", async ({
  browser,
}) => {
  const { a, b, close } = await openPanes(browser, "ux07-slash-replace");
  const target = inner(a, "a");
  await target.click();

  await a.keyboard.type("/head");
  await expect(menu(a)).toBeVisible();
  await a.keyboard.press("ArrowDown"); // Heading 2
  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);

  // The block's whole text was the trigger phrase: it converts by the
  // replace path — an empty heading (the phrase stripped, nothing else to
  // keep), synced to the other pane; the caret stands in the new block
  // (one undo step restores the phrase and the paragraph).
  const heading = a.locator('[data-testid="doc-a"] h2[data-block-type="heading"]');
  await expect(heading).toHaveCount(1);
  await expect(heading.locator('[data-slot="docblocks/block-content"]')).toHaveText("");
  await expect(b.locator('[data-testid="doc-b"] h2[data-block-type="heading"]')).toHaveCount(1);

  const outBefore = await outCount(a, "a");
  await a.keyboard.press("Control+z");
  await expect.poll(async () => outCount(a, "a")).toBe(outBefore + 1);
  await expect(a.locator('[data-testid="doc-a"] h2[data-block-type="heading"]')).toHaveCount(0);
  await expect(target).toHaveText("/head");
  await close();
});

test("a same-type command is an attrs update: the kind swap keeps the text", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux08-slash-kindswap");
  const target = inner(a, "a");
  await target.click();
  await a.keyboard.type("item");
  // Make the starter a bulleted list item (the list-type menu stands via the
  // format toolbar — the slash's own kind-swap is the pin below, so seed the
  // kind through the doc API).
  await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return;
    const order = doc.getChildren(doc.toJSON().id);
    const id = order[0];
    if (id !== undefined) doc.changeBlockType(id, "list-item", { list: "bullet" });
  }, "a");

  await target.click();
  await a.keyboard.press("End");
  await a.keyboard.type("/task");
  await expect(menu(a)).toBeVisible();
  await expect(menu(a).locator('[role="menuitem"]')).toHaveCount(1);
  await expect(menu(a).locator('[role="menuitem"]')).toHaveText("Task list");
  const outBefore = await outCount(a, "a");

  await a.keyboard.press("Enter");
  await expect(menu(a)).toHaveCount(0);
  const item = a.locator('[data-block-type="list-item"]');
  await expect(item).toHaveCount(1);
  await expect(item.locator('[data-slot="docblocks/block-content"]')).toHaveText("item");
  const attrs = await a.evaluate((c) => {
    const doc = window.__paneDocs?.[c as "a" | "b"] ?? null;
    if (doc === null) return null;
    const id = doc.getChildren(doc.toJSON().id)[0];
    return id === undefined ? null : (doc.getBlock(id)?.attrs ?? null);
  }, "a");
  expect(attrs).toEqual({ list: "task" });
  // One composed command: one wire update.
  expect(await outCount(a, "a")).toBe(outBefore + 1);
  await close();
});

test("code and latex do not trigger (a / there is plain text)", async ({ browser }) => {
  const { a, close } = await openPanes(browser, "ux09-slash-code");
  const target = inner(a, "a");
  await target.click();

  // A code block via the menu (the replace path on the phrase-only block).
  await a.keyboard.press("/");
  await expect(menu(a).getByRole("menuitem", { name: "Code block", exact: true })).toBeVisible();
  await menu(a).getByRole("menuitem", { name: "Code block", exact: true }).click();
  await expect(menu(a)).toHaveCount(0);
  const code = a.locator('[data-block-type="code"]');
  await expect(code).toHaveCount(1);

  // Inside the code block: the "/" is a plain character (no menu).
  const codeInner = code.locator('[data-slot="docblocks/block-content"]');
  await codeInner.click();
  await a.keyboard.type("a/b");
  await expect(menu(a)).toHaveCount(0);
  await expect(codeInner).toHaveText("a/b");

  // A latex block (the doc API's insert): the same exclusion.
  const latexId = await a.evaluate(() => window.__paneDocs?.a?.insertBlock("latex", { display: false }) ?? null);
  expect(latexId).not.toBeNull();
  const latexInner = a.locator(`[data-block-id="${latexId}"] [data-slot="docblocks/block-content"]`);
  await latexInner.click();
  await a.keyboard.type("x/y");
  await expect(menu(a)).toHaveCount(0);
  await expect(latexInner).toHaveText("x/y");
  await close();
});
