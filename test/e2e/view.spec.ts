import { expect, test } from "@playwright/test";

// Each test gets its own room via ?syncUrl= — the relay keeps rooms for
// the dev server's lifetime, so a shared room would be polluted by other
// spec files (and by manually opened tabs).
const RELAY = "ws://localhost:5199";

const ROOT = '[data-testid="doc-a"]';

test("the page/canvas view toggle renders the page miniature and the surface elements on one canvas", async ({
  page,
}) => {
  const room = `view-${Math.random().toString(36).slice(2, 8)}`;
  await page.goto(`/?canvas=1&syncUrl=${RELAY}/${room}`);
  await expect(page.getByTestId("status-a")).toHaveText("connected");

  const card = page.locator(`${ROOT} [data-slot="docblocks/page-card"]`);
  const area = page.locator(ROOT);

  // The canvas pane starts in the canvas view: the page is a miniature
  // rectangle with the page content inside. Assert the real bounding box —
  // a collapsed canvas view (zero height, overflow hidden) clips its
  // children out of the box, which toBeVisible cannot catch. The miniature
  // is taller than the canvas viewport (it scrolls inside the card), so the
  // checks are: the card center coincides with the canvas center (the
  // center-anchor origin) and the card substantially intersects the area.
  const cardBox = (await card.boundingBox())!;
  const areaBox = (await area.boundingBox())!;
  expect(cardBox, "the page card must be laid out").not.toBeNull();
  expect(Math.abs(cardBox.y + cardBox.height / 2 - (areaBox.y + areaBox.height / 2))).toBeLessThan(40);
  expect(cardBox.y).toBeLessThan(areaBox.y + areaBox.height);
  expect(cardBox.y + cardBox.height).toBeGreaterThan(areaBox.y);
  // The card is centered horizontally on the canvas (the center-anchor
  // origin), and the page content renders inside it.
  expect(Math.abs(cardBox.x + cardBox.width / 2 - (areaBox.x + areaBox.width / 2))).toBeLessThan(4);
  await expect(card).toContainText("Page content");

  // The surface elements share the canvas (the seeded doc has four canvas
  // items: two shapes, the canvas text, the connector), each laid out
  // inside the doc area, and the connector line resolves its endpoints
  // within the surface (an unresolved endpoint skips the line — presence
  // is the assertion).
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`)).toHaveCount(4);
  const itemBox = (await page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`).first().boundingBox())!;
  expect(itemBox, "the first canvas item must be laid out inside the doc area").not.toBeNull();
  expect(itemBox.y).toBeGreaterThanOrEqual(areaBox.y);
  await expect(page.locator(`${ROOT} [data-slot="docblocks/connector-layer"] path[data-connector-id]`)).toHaveCount(1);
  // The embedded surface viewport (the page-view rendering) is absent in
  // the canvas view.
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas"]`)).toHaveCount(0);

  // Switch to the page view: the page flows, the surface renders as the
  // embedded viewport, and the page card is gone.
  await page.getByTestId("view-a-page").click();
  await expect(card).toBeHidden();
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas"]`)).toBeVisible();

  // Switch back: the canvas view returns (the toggle is view state — the
  // document data is untouched by the switch) and the layout is intact
  // (the card center is back at the canvas center).
  await page.getByTestId("view-a-canvas").click();
  const cardBoxBack = (await card.boundingBox())!;
  expect(cardBoxBack, "the page card must be laid out after switching back").not.toBeNull();
  expect(Math.abs(cardBoxBack.y + cardBoxBack.height / 2 - (areaBox.y + areaBox.height / 2))).toBeLessThan(40);
  await expect(page.locator(`${ROOT} [data-slot="docblocks/canvas-item"]`)).toHaveCount(4);
});
