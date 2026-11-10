import { type Page, expect, test } from "@playwright/test";

import { RELAY, SETTLE, insertBlockType, twoPanes } from "./helpers";

/** Insert one v1 type at the root through the pane's harness control. */
async function insertType(page: Page, client: "a" | "b", type: string): Promise<void> {
  await insertBlockType(page, client, type);
}

test("an embed inserted in A renders in both panes and reaches the JSON", async ({ browser }) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed");

  await insertType(a, "a", "embed");

  for (const [pane, client] of [
    [a, "a"],
    [b, "b"],
  ] as const) {
    const doc = pane.locator(`[data-testid="doc-${client}"]`);

    // The plain iframe with the harness's fixed data: URL src (the `html`
    // kind — the write gate's only data-scheme stand)...
    const iframe = doc.locator('iframe[data-slot="docblocks/embed"]');
    await expect(iframe).toHaveCount(1);
    expect((await iframe.getAttribute("src")) ?? "").toContain("data:text/html");
    // ...and the kind on the wrapper (v1: every kind renders as an iframe).
    await expect(doc.locator('[data-block-type="embed"][data-kind="html"]')).toHaveCount(1);
    // Not text-editable: the wrapper carries no inner editable.
    expect(await doc.locator('[data-block-type="embed"] [data-slot="docblocks/block-content"]').count()).toBe(0);
  }

  // The JSON inspector of pane A shows the embed attrs.
  const jsonA = a.getByTestId("json-a");
  await expect.poll(async () => (await jsonA.innerText()).includes('"type": "embed"'), SETTLE).toBe(true);
  const jsonText = await jsonA.innerText();
  expect(jsonText).toContain('"kind": "html"');
  expect(jsonText).toContain("data:text/html");

  await close();
});

test("the catalog's embed renders in the motion pane (a non-text reorder target)", async ({ page }) => {
  const room = `ext01-motion-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&catalog=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The catalog embed is one of the root entries: it renders through the
  // motion view (no enter animation for entries present at mount) and is
  // not a drag source (no gutter handle on the wrapper).
  const embed = page.locator('[data-block-type="embed"]');
  await expect(embed).toHaveCount(1);
  await expect(embed).toHaveAttribute("data-kind", "html");
  await expect(embed.locator('[data-slot="docblocks/embed"]')).toBeVisible();
  expect(await embed.locator('[data-slot="docblocks/gutter"]').count()).toBe(0);
});

test("the slash Embed form inserts an embed block (the phrase strip, one undo step, over the wire)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-slash");
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await a.keyboard.type("/embed");

  const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem, "the Embed command filters to one entry").toHaveCount(1, SETTLE);
  await expect(menuItem).toHaveText("Embed");
  await a.keyboard.press("Enter");

  // The form stands over the open menu (the phrase intact), the URL input auto-focused.
  const form = a.locator("[data-slot='docblocks/slash-embed-form']");
  await expect(form).toBeVisible(SETTLE);
  const urlInput = form.locator("[data-slot='docblocks/slash-embed-url']");
  await expect(urlInput).toBeFocused(SETTLE);

  // A whitespace-only URL commits nothing (the form stands open on the phrase).
  await urlInput.fill("   ");
  expect(await form.locator("[data-slot='docblocks/slash-embed-insert']").isDisabled()).toBe(true);

  // Fill the URL and commit: the phrase strips and the embed block lands
  // over the wire (the doc holds the URL and the `iframe` kind, and nothing
  // else — the form stands the URL only, the kind's default stands the
  // committed attr).
  await urlInput.fill("https://example.com/embedded");
  await form.locator("[data-slot='docblocks/slash-embed-insert']").click();

  const wrapper = a.locator("[data-block-type='embed']");
  await expect(wrapper).toHaveCount(1, SETTLE);
  await expect(wrapper).toHaveAttribute("data-kind", "iframe");
  const iframe = wrapper.locator('iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveAttribute("src", "https://example.com/embedded");

  // The doc holds only the committed attrs (the phrase is stripped).
  const attrs = await a.evaluate(() => {
    const doc = window.__paneDocs!.a!;
    const state = doc.toJSON();
    const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed")!;
    return state.blocks[embedId]!.attrs;
  });
  expect(attrs).toEqual({ kind: "iframe", src: "https://example.com/embedded" });

  // Pane B receives the embed over the wire.
  await expect(b.locator("[data-block-type='embed'][data-kind='iframe']")).toHaveCount(1, SETTLE);

  // The insert is one undo step: Ctrl+Z removes the embed block.
  await a.keyboard.press("Control+z");
  await expect(a.locator("[data-block-type='embed']")).toHaveCount(0, SETTLE);

  await close();
});

test("the slash Embed form's Escape cancels (commits nothing, the phrase stands)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-slash-cancel");
  const inner = a.locator('[data-testid="doc-a"] [data-slot="docblocks/block-content"]').first();
  await inner.click();
  await a.keyboard.type("/embed");

  const menuItem = a.locator('[data-slot="docblocks/slash-menu"] [role="menuitem"]');
  await expect(menuItem).toHaveCount(1, SETTLE);
  await a.keyboard.press("Enter");

  const form = a.locator("[data-slot='docblocks/slash-embed-form']");
  await expect(form).toBeVisible(SETTLE);
  await form.locator("[data-slot='docblocks/slash-embed-url']").fill("https://example.com/nope");

  // Escape cancels the form: the command list stands back on the phrase, no
  // embed block lands.
  await form.locator("[data-slot='docblocks/slash-embed-url']").press("Escape");
  await expect(form).toBeHidden(SETTLE);
  expect(await a.locator("[data-block-type='embed']").count()).toBe(0);
  // The phrase is intact (the "/embed" still stands in the text).
  const text = await inner.innerText();
  expect(text).toContain("/embed");

  await close();
});

test("the embed's toolbar zoom persists over the doc's attrs (the panes share the persisted view)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-panzoom");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');
  const iframeB = b.locator('[data-testid="doc-b"] [data-block-type="embed"] iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveAttribute("style", /scale\(1\)/);

  // The persisted view's read over the block's attrs (the null idiom: the
  // identity's zoom stands `null` / absent).
  const zoomAttr = () =>
    a.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { zoom?: number | null };
      return attrs.zoom ?? null;
    });

  // Hover reveals the toolbar. Zoom in: the view stands...
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await expect(iframe).toHaveAttribute("style", /scale\(1\.2\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("120%");

  // ...and the debounce lands it over the block's attrs (the persist's
  // write): the doc holds the view, and pane B's embed adopts it over the
  // wire (the panes share the persisted view).
  await expect.poll(zoomAttr, SETTLE).toBeCloseTo(1.2);
  await expect(iframeB).toHaveAttribute("style", /scale\(1\.2\)/, SETTLE);

  // The reset stands the cleared view (the null idiom) over the wire.
  await embed.locator('[data-slot="docblocks/embed-zoom-reset"]').click();
  await expect(iframe).toHaveAttribute("style", /translate\(0px, 0px\) scale\(1\)/);
  await expect(embed.locator('[data-slot="docblocks/embed-zoom"]')).toHaveText("100%");
  await expect(iframeB).toHaveAttribute("style", /translate\(0px, 0px\) scale\(1\)/, SETTLE);
  await expect.poll(zoomAttr, SETTLE).toBeNull();

  await close();
});

test("the embed's wheel: ctrl/cmd zooms at the cursor, a plain wheel pans (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-wheel");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  const readScale = async (): Promise<number> => {
    const style = (await iframe.getAttribute("style")) ?? "";
    const match = style.match(/scale\(([\d.]+)\)/);
    return match === null ? 1 : Number.parseFloat(match[1] ?? "1");
  };

  // ctrl+wheel (deltaY < 0) zooms in at the cursor: the scale grows.
  const box = (await embed.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const beforeZoom = await readScale();
  await embed.dispatchEvent("wheel", { deltaY: -240, deltaMode: 0, ctrlKey: true, clientX: cx, clientY: cy });
  expect(await readScale()).toBeGreaterThan(beforeZoom);

  // A plain wheel pans vertically (content opposite to the delta): with the
  // overflow in place (zoomed in), the translate's y stands changed.
  const beforePan = (await iframe.getAttribute("style")) ?? "";
  await embed.dispatchEvent("wheel", { deltaY: 300, deltaMode: 0, clientX: cx, clientY: cy });
  const afterPan = (await iframe.getAttribute("style")) ?? "";
  expect(afterPan).not.toBe(beforePan);
  // The y translate moved (the vertical pan stood).
  const parseY = (s: string): number =>
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)?.[2] ?? "0");
  expect(parseY(afterPan)).not.toBe(parseY(beforePan));

  await close();
});

test("the embed's modifier drag-pan: an Alt-held drag pans the overflow (view state)", async ({ browser }) => {
  const { a, close } = await twoPanes(browser, "ext01-embed-dragpan");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // Zoom in first (the toolbar) so the scaled embed overflows the wrapper.
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();

  const box = (await embed.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // An Alt-held drag pans (the iframe yields its pointer events to the
  // wrapper while the modifier stands — the re-render stands before the
  // press, so wait for the yield). The translate's x stands changed.
  await a.keyboard.down("Alt");
  await expect(iframe).toHaveCSS("pointer-events", "none", SETTLE);
  const beforeAlt = (await iframe.getAttribute("style")) ?? "";
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx - 60, cy, { steps: 4 });
  await a.mouse.up();
  await a.keyboard.up("Alt");
  const afterAlt = (await iframe.getAttribute("style")) ?? "";
  expect(afterAlt).not.toBe(beforeAlt);
  const parseX = (s: string): number =>
    Number.parseFloat(s.match(/translate\((-?[\d.]+)px, (-?[\d.]+)px\)/)?.[1] ?? "0");
  expect(parseX(afterAlt)).toBeLessThan(parseX(beforeAlt));

  // An unmodified drag does NOT pan: the iframe keeps its own interaction
  // (the pan session requires the modifier), so the transform stands unchanged.
  const beforePlain = (await iframe.getAttribute("style")) ?? "";
  await a.mouse.move(cx, cy);
  await a.mouse.down();
  await a.mouse.move(cx - 60, cy, { steps: 4 });
  await a.mouse.up();
  expect((await iframe.getAttribute("style")) ?? "").toBe(beforePlain);

  await close();
});

test("the embed's default sandbox stands the same-origin grant (the app's own storage; the parent's state is reachable)", async ({
  page,
}) => {
  await page.goto(`/?client=a&syncUrl=${RELAY}/sandbox-embed-${Math.random().toString(36).slice(2, 8)}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // Listen for the fixture's postMessage (the script's run marker).
  await page.evaluate(() => {
    (window as { __sandboxran?: boolean }).__sandboxran = false;
    window.addEventListener("message", (event) => {
      if (event.data && event.data.sandbox === "ran") (window as { __sandboxran?: boolean }).__sandboxran = true;
    });
  });

  // Insert an embed pointing at the playground-served same-origin fixture
  // (Vite's public dir) as an ABSOLUTE http URL (the write gate's stand —
  // the src must be an absolute http/https). The fixture's origin is the
  // page's own, so the fixture stands the same-origin stand: it attempts to
  // write a marker to the parent's state (the grant's posture consequence —
  // the consumer's `embedSandbox` policy stands the restriction).
  const fixtureUrl = await page.evaluate(() => new URL("sandbox-test-embed.html", window.location.href).href);
  const embedId = await page.evaluate(
    ({ fixtureUrl }) => window.__paneDocs!.a!.insertBlock("embed", { kind: "iframe", src: fixtureUrl }),
    { fixtureUrl }
  );

  const iframe = page.locator(`[data-block-id="${embedId}"] iframe[data-slot="docblocks/embed"]`);
  await expect(iframe).toHaveCount(1, SETTLE);
  await expect(iframe).toHaveAttribute("src", fixtureUrl, SETTLE);

  // The default sandbox grants the same-origin (the real-app's stand: the
  // embedded app's own storage / cookies stand, the app boots like in a
  // plain tab).
  const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
  expect(sandbox).toContain("allow-same-origin");

  // The fixture's script ran (the postMessage landed)...
  await expect.poll(() => page.evaluate(() => (window as { __sandboxran?: boolean }).__sandboxran), SETTLE).toBe(true);

  // ...and the same-origin fixture's parent's state is reachable (the
  // marker landed — the grant's consequence: a same-origin URL reaches the
  // parent over `window.parent`).
  const marker = await page.evaluate(() => (window as { __sandboxmarker?: string }).__sandboxmarker);
  expect(marker).toBe("pwned");
});

test("the embed's bottom-edge resize stretches the block (the persisted height: the wire's adopt + the reload's restore)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-resize");
  await insertType(a, "a", "embed");
  const wrapper = a.locator("[data-block-type='embed']");
  await expect(wrapper).toHaveCount(1, SETTLE);

  // The height's read over the block's attrs (the null idiom: the default's
  // stand stands `null` / absent). Each pane's doc stands read over its own
  // page (the harness's `__paneDocs` exposes the page's own doc only).
  const heightAttr = (client: "a" | "b") =>
    (client === "a" ? a : b).evaluate((which: "a" | "b") => {
      const doc = (which === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return null;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { height?: number | null };
      return attrs.height ?? null;
    }, client);

  // The default's stand: the token's height (the minimum's stand).
  const defaultHeight = await wrapper.evaluate((el) => el.getBoundingClientRect().height);
  expect(await heightAttr("a")).toBeNull();

  // The hover's reveal stands the handle (the grip's bar's stand); the
  // bottom-edge's drag down 120 px stands the stretch...
  await wrapper.hover();
  const handle = wrapper.locator('[data-slot="docblocks/embed-resize"]');
  await expect(handle).toBeAttached();
  const box = (await wrapper.boundingBox())!;
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height - 4; // the handle's band (the bottom's 8 px)
  await a.mouse.move(startX, startY);
  await a.mouse.down();
  await a.mouse.move(startX, startY + 120, { steps: 5 });
  await a.mouse.up();

  // ...the wrapper's height stands the stretch, and the rest's write lands
  // the px over the block's attrs (the persist's stand).
  const stretchedHeight = await wrapper.evaluate((el) => el.getBoundingClientRect().height);
  expect(stretchedHeight).toBeGreaterThan(defaultHeight);
  await expect.poll(() => heightAttr("a"), SETTLE).toBeCloseTo(stretchedHeight, 0);

  // The wire's adopt: pane B's embed stands the stretched height over the
  // peer's write (the panes' shared view).
  const wrapperB = b.locator('[data-testid="doc-b"] [data-block-type="embed"]');
  await expect
    .poll(() => wrapperB.evaluate((el) => el.getBoundingClientRect().height), SETTLE)
    .toBeCloseTo(stretchedHeight, 0);

  // The reload's stand: the fresh mount's embed restores the stretched
  // height (the transform's stand: no flash of the default).
  await a.reload();
  await expect(a.getByTestId("status-a")).toHaveText("connected");
  const restored = a.locator("[data-block-type='embed']");
  await expect
    .poll(() => restored.evaluate((el) => el.getBoundingClientRect().height), SETTLE)
    .toBeCloseTo(stretchedHeight, 0);

  await close();
});

test("the toolbar's edit changes the embed's URL (the commit's write over the wire; the cancel's no-write)", async ({
  browser,
}) => {
  const { a, b, close } = await twoPanes(browser, "ext01-embed-editurl");
  await insertType(a, "a", "embed");
  const embed = a.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // The src's read over the block's attrs (each pane's doc stands read over
  // its own page — the harness's `__paneDocs` exposes the page's own doc only).
  const src = (client: "a" | "b") =>
    (client === "a" ? a : b).evaluate((which: "a" | "b") => {
      const doc = (which === "a" ? window.__paneDocs?.a : window.__paneDocs?.b) ?? null;
      if (doc === null) return null;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { src?: string };
      return attrs.src ?? null;
    }, client);

  // The edit's open: the hover's reveal + the button's click stands the panel
  // over the current src (the pre-fill's stand), the input's focused.
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-edit-url"]').click();
  const input = embed.locator('[data-slot="docblocks/embed-edit-input"]');
  await expect(input).toBeFocused(SETTLE);
  expect(await input.inputValue()).toContain("data:text/html");

  // The commit's Enter: the new src stands the doc's write + the iframe's
  // navigation, and pane B adopts it over the wire (the panes' shared src).
  await input.fill("https://example.com/embedded");
  await input.press("Enter");
  await expect(iframe).toHaveAttribute("src", "https://example.com/embedded");
  await expect.poll(() => src("a"), SETTLE).toBe("https://example.com/embedded");
  const iframeB = b.locator('[data-testid="doc-b"] [data-block-type="embed"] iframe[data-slot="docblocks/embed"]');
  await expect(iframeB).toHaveAttribute("src", "https://example.com/embedded", SETTLE);
  await expect.poll(() => src("b"), SETTLE).toBe("https://example.com/embedded");

  // The cancel's stand: the panel's open, the draft's change, the Escape's
  // close writes nothing (the src's untouched, the panel's gone).
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-edit-url"]').click();
  await embed.locator('[data-slot="docblocks/embed-edit-input"]').fill("https://example.com/other");
  await embed.locator('[data-slot="docblocks/embed-edit-input"]').press("Escape");
  await expect(embed.locator('[data-slot="docblocks/embed-edit"]')).toBeHidden(SETTLE);
  expect(await src("a")).toBe("https://example.com/embedded");

  await close();
});

test("the embed's pan/zoom survives the reload (the persisted view's restore)", async ({ page }) => {
  const room = `ext01-embed-persist-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  await insertType(page, "a", "embed");
  const embed = page.locator("[data-block-type='embed']");
  await expect(embed).toHaveCount(1, SETTLE);
  const iframe = embed.locator('iframe[data-slot="docblocks/embed"]');

  // The persisted view's read over the block's attrs (the null idiom: the
  // identity's zoom stands `null` / absent).
  const zoomAttr = (): Promise<number | null> =>
    page.evaluate(() => {
      const doc = window.__paneDocs!.a!;
      const state = doc.toJSON();
      const embedId = Object.keys(state.blocks).find((id) => state.blocks[id]!.type === "embed");
      if (embedId === undefined) return null;
      const attrs = state.blocks[embedId]!.attrs as { zoom?: number | null };
      return attrs.zoom ?? null;
    });

  // Zoom in twice (the toolbar): the view stands, and the debounce's write
  // lands over the block's attrs (the persist's stand)...
  await embed.hover();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await embed.locator('[data-slot="docblocks/embed-zoom-in"]').click();
  await expect(iframe).toHaveAttribute("style", /scale\(1\.44\)/);
  await expect.poll(zoomAttr, SETTLE).toBeCloseTo(1.44);

  // ...and the reload's stand: the fresh mount's embed restores the
  // persisted view (the transform stands it — no flash of the identity).
  await page.reload();
  await expect(page.getByTestId("status-a")).toHaveText("connected");
  const restored = page.locator('[data-block-type="embed"] iframe[data-slot="docblocks/embed"]');
  await expect(restored).toHaveAttribute("style", /scale\(1\.44\)/, SETTLE);
});

test("a text's press after the iframe's focus stands the focus's move out of the frame (the caret's re-seat)", async ({
  page,
}) => {
  const room = `ext01-embed-iframe-focus-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?client=a&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  // The same-origin fixture's embed (the frame's document's focus's
  // stand — the click's seat stands the frame's focus).
  const fixtureUrl = await page.evaluate(() => new URL("sandbox-test-embed.html", window.location.href).href);
  await page.evaluate((fixtureUrl) => {
    window.__paneDocs!.a!.insertBlock("embed", { kind: "iframe", src: fixtureUrl });
  }, fixtureUrl);
  const iframe = page.locator('[data-block-type="embed"] iframe[data-slot="docblocks/embed"]');
  await expect(iframe).toHaveCount(1, SETTLE);
  await expect(iframe).toBeVisible(SETTLE);

  // The click inside the iframe: the frame's document stands focused (the
  // parent's activeElement stands the iframe element).
  await iframe.click();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName === "IFRAME"), SETTLE).toBe(true);

  // A single press over a text inner: the focus's move out of the frame
  // stands (the mousedown's default — the editor's mousedown suppression
  // would leave the document unfocused: the caret's seat over the unfocused
  // document, no visible caret, the keys' no-stand).
  const inner = page.locator('[data-slot="docblocks/block-content"]').first();
  await inner.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            document.activeElement.closest('[data-slot="docblocks/block-content"]') !== null
        ),
      SETTLE
    )
    .toBe(true);

  // The caret's stand: the collapsed selection over the inner (the keys'
  // reach stands).
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const selection = window.getSelection();
          return (
            selection !== null &&
            selection.rangeCount > 0 &&
            selection.isCollapsed &&
            (selection.anchorNode instanceof Element
              ? selection.anchorNode.closest('[data-slot="docblocks/block-content"]')
              : null) !== null
          );
        }),
      SETTLE
    )
    .toBe(true);

  // The keys' reach: the type lands over the inner (the pre-fix's stand was
  // the frame's focus — the type's no-stand over the parent).
  await page.keyboard.type("Focus after iframe");
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const inner = document.querySelector('[data-slot="docblocks/block-content"]');
          return inner !== null && inner.textContent === "Focus after iframe";
        }),
      SETTLE
    )
    .toBe(true);
});
