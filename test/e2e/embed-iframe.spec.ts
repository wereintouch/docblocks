// The same-origin fixture's iframe: the default sandbox's grant (the parent's state's
// reach), and the text's press's focus's move out of the frame (the caret's re-seat).
import { expect, test } from "@playwright/test";

import { RELAY, SETTLE } from "./helpers";

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

test("a text's press after the iframe's focus stands the focus's move out of the frame (the caret's re-seat)", async ({
  page,
}) => {
  const room = `embed-iframe-focus-${Math.random().toString(36).slice(2, 8)}`;
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
  // document, no visible caret, the keys' no-stand). The focus lands in
  // the editor (the shared page container or the inner — the span model's
  // focus stand), and the caret seats in the inner.
  const inner = page.locator('[data-slot="docblocks/block-content"]').first();
  await inner.click();
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.activeElement instanceof HTMLElement &&
            (document.activeElement.closest('[data-slot="docblocks/block-content"]') !== null ||
              document.activeElement.closest('[data-slot="docblocks/page"]') !== null)
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
