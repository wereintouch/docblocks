import { type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { grantClipboardPermissions } from "./clipboard";
import { HOME_END_STAND, homeEndStandEngine } from "./home-end";
import { RELAY } from "./wire";

/**
 * Insert one v1 block of `type` into the pane's doc with the harness attrs
 * (the playground pane's `window.__insertBlock` hook — the command API in
 * place of the removed insert controls) and return the inserted block's id.
 */
async function insertBlockType(page: Page, client: "a" | "b", type: string): Promise<string> {
  const id = await page.evaluate(({ client, type }) => window.__insertBlock?.(client, type) ?? null, {
    client,
    type,
  });
  if (id === null) throw new Error(`the ${client} pane's insert hook is not mounted (type: ${type})`);
  return id;
}

/**
 * Switch the pane's editor view (the page / the canvas) through the
 * DocHeader's view switcher (the pane's single mode control — the former
 * toggle buttons stand removed). The pane stands alone on its page (one
 * DocHeader), so the switcher's button is the page-level locator; the wait
 * pins the view's DOM stand (the canvas view's slot for the canvas, the
 * page's content column for the page — the `first` over the mini-card's
 * nested page column) and the harness's mount timing.
 */
async function switchPaneView(page: Page, client: "a" | "b", view: "page" | "canvas"): Promise<void> {
  await page
    .locator('[data-slot="docblocks/doc-header-view"]')
    .getByRole("button", { name: view === "page" ? "Page view" : "Canvas view" })
    .click();
  const slot = view === "canvas" ? "docblocks/canvas-view" : "docblocks/page";
  await page.locator(`[data-testid="doc-${client}"] [data-slot="${slot}"]`).first().waitFor({ state: "visible" });
}

async function editorContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (homeEndStandEngine(browser)) {
    await context.addInitScript(HOME_END_STAND);
    (context as unknown as { __stands?: boolean }).__stands = true;
  }
  return context;
}

/** The pane's editor root (the harness's per-client doc area). */
const pane = (page: Page, client: "a" | "b") => page.locator(`[data-testid="doc-${client}"]`);

/**
 * Open the pane on the relay's room and wait for the connected status.
 * `cycle` appends the sync-embed's `?cycle=1` flag; `settle` overrides the
 * status wait timeout; `url` replaces the relay's room URL (the real-server
 * spec); `light` clears the harness's default dark class (the light seed
 * pins); `first` targets the first status node (the page-level panes render
 * two); `role` stands the pane's access level (the `?role=viewer`'s
 * flag — the published's forced stand over the package's contract);
 * `blobEager` stands the provider's eager blob loading policy (the
 * `?blobEager=1`'s flag).
 */
async function openPane(
  page: Page,
  client: "a" | "b",
  room: string,
  options: {
    cycle?: boolean;
    settle?: { timeout: number };
    url?: string;
    light?: boolean;
    first?: boolean;
    role?: "editor" | "viewer";
    attrDemo?: boolean;
    blobEager?: boolean;
  } = {}
): Promise<void> {
  // The Home/End stand installs over the page when the context's init
  // script did not (the engine's Home/End keys are no-ops over the
  // contenteditable); the editorContext's contexts carry it over the
  // context's init script.
  const engineContext = page.context();
  if (
    homeEndStandEngine(page.context().browser()!) &&
    (engineContext as unknown as { __stands?: boolean }).__stands !== true
  ) {
    await page.addInitScript(HOME_END_STAND);
    (engineContext as unknown as { __stands?: boolean }).__stands = true;
  }
  const url =
    options.url ??
    `/?client=${client}&syncUrl=${RELAY}/${room}${options.cycle ? "&cycle=1" : ""}${options.role === "viewer" ? "&role=viewer" : ""}${options.attrDemo ? "&attrDemo=1" : ""}${options.blobEager ? "&blobEager=1" : ""}`;
  await page.goto(url);
  const status = options.first ? page.getByTestId(`status-${client}`).first() : page.getByTestId(`status-${client}`);
  await connectedStatus(page, client, status, options.settle?.timeout ?? 15_000);
  if (options.light) {
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  }
}

/**
 * The pane's connection's settle with the engine's load-time connection's
 * drop stand (the firefox's engine drops the WS's attempt made during the
 * page's load, the provider stands no auto-reconnect — the harness's
 * reconnect control stands the retry). The retry is periodic (not a
 * single shot) — over the load the page's mount and the first reconnect's
 * attempt may both land in the drop's window, so the retry repeats until
 * the settle's end. The engine-independent chromium's first attempt lands
 * (the click never fires there).
 */
async function connectedStatus(page: Page, client: "a" | "b", status: Locator, timeout: number): Promise<void> {
  const start = Date.now();
  let lastRetry = 0;
  const retryInterval = Math.max(5_000, timeout / 3);
  for (;;) {
    const text = await status.textContent().catch(() => null);
    if (text === "connected") return;
    if (Date.now() - start >= timeout) {
      throw new Error(
        `the pane's status stands "${text ?? "(none)"}" over the ${timeout} ms settle (the connected's stand)`
      );
    }
    const now = Date.now();
    if (now - lastRetry >= retryInterval) {
      const button = page.getByTestId(`reconnect-${client}`).first();
      if ((await button.count()) > 0) {
        await button.click().catch(() => {});
        lastRetry = now;
      }
    }
    await page.waitForTimeout(500);
  }
}

/**
 * Two relay panes in isolated browser contexts (the a / b clients on one
 * room; the room gets a per-run suffix so a shared room never stands
 * polluted across spec files). `viewerB` stands the b pane's viewer's
 * access level (the access's A/B demo: the a's editor pane, the b's
 * viewer pane).
 */
async function twoPanes(
  browser: Browser,
  room: string,
  options: {
    cycle?: boolean;
    permissions?: string[];
    light?: boolean;
    first?: boolean;
    viewerB?: boolean;
    attrDemo?: boolean;
  } = {}
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  if (options.permissions) {
    await grantClipboardPermissions(contextA);
    await grantClipboardPermissions(contextB);
  }
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom, {
    cycle: options.cycle,
    light: options.light,
    first: options.first,
    attrDemo: options.attrDemo,
  });
  await openPane(b, "b", uniqueRoom, {
    cycle: options.cycle,
    light: options.light,
    first: options.first,
    role: options.viewerB ? "viewer" : undefined,
    attrDemo: options.attrDemo,
  });
  return {
    a,
    b,
    close: async () => {
      await contextA.close();
      await contextB.close();
    },
  };
}

export { editorContext, insertBlockType, openPane, pane, switchPaneView, twoPanes };
