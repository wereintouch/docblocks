import { type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { DatabaseBridge } from "docblocks-react-ui";

declare global {
  interface Window {
    /** The playground pane's insert hook (harness attrs; see apps/playground/src/insert-blocks.ts). */
    __insertBlock?: (client: "a" | "b", type: string) => string | null;
    /** The playground panes' live docs (per letter; null until the pane is mounted) — the command API the e2e suite reads/drives. */
    __paneDocs?: { a: PaneDoc | null; b: PaneDoc | null };
    /** The playground panes' master docs (the sync-embed targets, per letter; null until the pane is mounted) — the master's command API the e2e suite reads/drives. */
    __masterDocs?: { a: MasterDoc | null; b: MasterDoc | null };
    /** The catalog pane's live doc (catalog mode only; null outside it) — the harness global the visual spec reads for the byte-stable snapshot. */
    __catalogDoc?: PaneDoc | null;
    /** The playground pane's default database bridge (harness global; the state is per page) — the e2e bridge suite reads/drives it. */
    __bridge?: DatabaseBridge;
    /** The page's paste payload's stash (the no-grant engine's stand: the firefox/webkit's clipboard's read takes no permission — the seed's write stands here, the paste's dispatch reads it). */
    __pbSeed?: { html?: string; plain?: string };
    /** The app's clipboard write's capture queue (the no-read engine's copy's assertion stand: the `copy`'s event + the clipboard API's write(s) intercepted). */
    __pbWrites?: { html?: string; plain?: string }[];
    /** The playground pane's published stand's re-read (the publish.ts's harness stand: the room's shared localStorage stand over the pane's published's prop; true when a stand was applied) — the e2e's A/B publish flow drives it. */
    __reloadPublished?: (client: "a" | "b") => boolean;
  }
}

/**
 * The block-snapshot shape a spec reads (a harness view of core's `Block` —
 * the type-optional fields: `content` for the text types, `rows`/`rowOrder`
 * for the database, `columnOrder` for the table, `children` for containers).
 */
interface PaneBlock {
  type: string;
  attrs?: Record<string, unknown>;
  content?: { text: string; marks: Record<string, unknown> }[];
  children?: string[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
  columnOrder?: string[];
  geometry?: { x: number; y: number; w: number; h: number };
}

/**
 * The structural surface of the panes' live docs a spec may read/drive (the
 * mounted global is the full core `Doc` — this partial typing mirrors core's
 * public command signatures, loosened where core is generic).
 */
interface PaneDoc {
  meta: { id: string; title: string; avatar?: string };
  toJSON(): {
    id: string;
    blocks: Record<string, PaneBlock>;
  };
  getChildren(id: string): string[];
  getBlock(id: string): PaneBlock | null;
  getText(id: string): string;
  /** The CRDT's raw escape hatch (the power-user API; the crafted-update specs drive it). */
  raw: { getMap: (name: string) => { get: (key: string) => unknown } };
  getRuns(id: string): { text: string; marks: Record<string, unknown> }[];
  insertBlock(type: string, attrs?: Record<string, unknown>, position?: { parent?: string; after?: string }): string;
  setTitle(title: string): void;
  insertText(blockId: string, pos: number, text: string, marks?: Record<string, unknown>): void;
  updateBlock(id: string, attrs: Record<string, unknown>): void;
  setCell(
    databaseId: string,
    rowId: string,
    colId: string,
    value: string | number | boolean | string[] | undefined
  ): void;
  insertRow(databaseId: string): string;
  moveRow(databaseId: string, rowId: string, toIndex: number): void;
  removeRow(databaseId: string, rowId: string): void;
  moveBlock(id: string, toParent: string, toIndex: number): void;
  changeBlockType(id: string, type: string, attrs?: Record<string, unknown>): void;
  setGeometry(id: string, geometry: { x?: number; y?: number; w?: number; h?: number } | null): void;
  setMark(blockId: string, from: number, to: number, mark: unknown): void;
  insertTableRow(tableId: string, at?: number): string;
  removeTableRow(tableId: string, rowId: string): void;
  moveTableRow(tableId: string, rowId: string, toIndex: number): void;
  duplicateTableRow(tableId: string, rowId: string): string;
  clearTableRow(tableId: string, rowId: string): void;
  insertTableColumn(tableId: string, at?: number): void;
  removeTableColumn(tableId: string, index: number): void;
  moveTableColumn(tableId: string, fromIndex: number, toIndex: number): void;
  duplicateTableColumn(tableId: string, index: number): void;
  clearTableColumn(tableId: string, index: number): void;
  setTableColumnColor(tableId: string, index: number, color: string | null): void;
  setTableColumnWidth(tableId: string, index: number, width: number): void;
  removeBlock(id: string): void;
  undo(): void;
  redo(): void;
  transact(fn: () => void): void;
}

/** The pane's master doc (the sync-embed target) — the structural surface the specs may read/drive (the mounted global is the full core `Doc`). */
type MasterDoc = PaneDoc;

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

/** The in-process relay the dev server hosts (the playwright config's webServer; the strict port). */
const RELAY = "ws://localhost:5199";

/**
 * A browser context over the harness's pages with the engine stands
 * installed (the firefox engine's Home/End's stand — the engine's
 * contenteditable stands no Home/End's native caret move, the
 * capture-phase stand stands the line's edges). The specs' pane helpers
 * take their contexts from here so the stands reach every page.
 */
async function editorContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext();
  if (browser.browserType().name() === "firefox") {
    await context.addInitScript(HOME_END_STAND);
    (context as unknown as { __stands?: boolean }).__stands = true;
  }
  return context;
}

/**
 * The firefox engine's Home/End stand (the e2e's gesture's stand): the
 * engine's contenteditable stands no Home/End's native caret move (the
 * arrows work, the line's edges stand the key's no-op), so the
 * capture-phase stand moves the caret to the line's edge (the default's
 * stand) and extends the selection's focus over the shift hold. The line
 * stands the logical text's line break (the trailing line-anchor's ZWSP
 * carries no logical character). The install stands the init script over
 * the page (before the navigation) — the engine's quirk's stand, the
 * product's behavior stands the browser's default (the real firefox's
 * keys work).
 */
const HOME_END_STAND = `(() => {
  const isLineAnchorText = (n) =>
    n !== null &&
    n.nodeType === Node.TEXT_NODE &&
    n.parentElement !== null &&
    n.parentElement.closest("span[data-slot='docblocks/line-anchor']") !== null;
  const logicalLengthOf = (n) => {
    if (n.nodeType === Node.TEXT_NODE) return isLineAnchorText(n) ? 0 : (n.nodeValue !== null ? n.nodeValue.length : 0);
    let sum = 0;
    const tw = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    for (let m = tw.nextNode(); m !== null; m = tw.nextNode()) {
      if (!isLineAnchorText(m)) sum += m.nodeValue !== null ? m.nodeValue.length : 0;
    }
    return sum;
  };
  const lineEdge = (inner, endpoint, isStart) => {
    const map = [];
    let total = 0;
    const walker = document.createTreeWalker(inner, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const raw = n.nodeValue !== null ? n.nodeValue.length : 0;
      const len = isLineAnchorText(n) ? 0 : raw;
      map.push({ n, start: total, len, raw });
      total += len;
    }
    const logical = map.reduce((a, e) => (e.len === 0 ? a : a + (e.n.nodeValue ?? "")), "");
    const entry = map.find((e) => e.n === endpoint.c);
    let idx;
    if (entry !== undefined) {
      idx = entry.start + (entry.len === 0 ? 0 : endpoint.o);
    } else if (endpoint.c === inner) {
      idx = 0;
      for (let i = 0; i < endpoint.o; i += 1) {
        const child = inner.childNodes[i];
        if (child !== undefined) idx += logicalLengthOf(child);
      }
    } else if (endpoint.c.nodeType === Node.ELEMENT_NODE && inner.contains(endpoint.c)) {
      idx = 0;
      for (let node = inner.firstChild; node !== null && node !== endpoint.c; node = node.nextSibling) {
        idx += logicalLengthOf(node);
      }
    } else {
      return null;
    }
    const br = isStart ? logical.lastIndexOf("\\n", idx - 1) : logical.indexOf("\\n", idx);
    const target = isStart ? (br === -1 ? 0 : br + 1) : br === -1 ? logical.length : br;
    let acc = 0;
    for (const e of map) {
      if (e.len === 0) continue;
      if (acc + e.len > target) return { node: e.n, off: target - acc };
      acc += e.len;
    }
    const last = map[map.length - 1];
    return last !== undefined ? { node: last.n, off: last.raw } : null;
  };
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Home" && event.key !== "End") return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const sel = window.getSelection();
      if (sel === null || sel.rangeCount === 0) return;
      const extending = event.shiftKey;
      // A plain key over a non-collapsed selection: the browser's stand.
      if (!extending && !sel.isCollapsed) return;
      // The shift's extend stands the selection's anchor (the caret's
      // stand over the collapse); the plain key's stand takes the caret
      // (the anchor over the collapse).
      const endpoint = { c: sel.anchorNode, o: sel.anchorOffset };
      if (endpoint.c === null) return;
      const host = endpoint.c.nodeType === Node.TEXT_NODE ? endpoint.c.parentElement : endpoint.c;
      const inner = host && host.closest ? host.closest("[data-slot='docblocks/block-content']") : null;
      if (inner === null || !inner.isContentEditable) return;
      const pos = lineEdge(inner, endpoint, event.key === "Home");
      if (pos === null) return;
      event.preventDefault();
      if (extending) {
        sel.setBaseAndExtent(sel.anchorNode, sel.anchorOffset, pos.node, pos.off);
        return;
      }
      const range = document.createRange();
      range.setStart(pos.node, pos.off);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    },
    true
  );
})();`;

/** The slow-machine settle window for the wire/log polls. */
const SETTLE: { timeout: number } = { timeout: 15_000 };

/** The pane's editor root (the harness's per-client doc area). */
const pane = (page: Page, client: "a" | "b") => page.locator(`[data-testid="doc-${client}"]`);

/**
 * Open the pane on the relay's room and wait for the connected status.
 * `cycle` appends the sync-embed's `?cycle=1` flag; `settle` overrides the
 * status wait timeout; `url` replaces the relay's room URL (the real-server
 * spec); `light` clears the harness's default dark class (the light seed
 * pins); `first` targets the first status node (the page-level panes render
 * two); `role` stands the pane's access level (the `?role=viewer`'s
 * flag — the published's forced stand over the package's contract).
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
  } = {}
): Promise<void> {
  // The firefox engine's Home/End's stand stands over the page (the engine
  // quirk's stand — the engine's keys are no-ops over the contenteditable);
  // the editorContext's contexts carry it over the context's init script.
  const engineContext = page.context();
  if (
    engineContext.browser()?.browserType().name() === "firefox" &&
    (engineContext as unknown as { __stands?: boolean }).__stands !== true
  ) {
    await page.addInitScript(HOME_END_STAND);
    (engineContext as unknown as { __stands?: boolean }).__stands = true;
  }
  const url =
    options.url ??
    `/?client=${client}&syncUrl=${RELAY}/${room}${options.cycle ? "&cycle=1" : ""}${options.role === "viewer" ? "&role=viewer" : ""}`;
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
 * reconnect control stands the retry). The click stands the second
 * attempt; the engine-independent chromium's first attempt lands (the
 * click never fires there).
 */
async function connectedStatus(page: Page, client: "a" | "b", status: Locator, timeout: number): Promise<void> {
  const start = Date.now();
  let retried = false;
  for (;;) {
    const text = await status.textContent().catch(() => null);
    if (text === "connected") return;
    if (Date.now() - start >= timeout) {
      throw new Error(
        `the pane's status stands "${text ?? "(none)"}" over the ${timeout} ms settle (the connected's stand)`
      );
    }
    if (!retried && Date.now() - start >= timeout / 2) {
      const button = page.getByTestId(`reconnect-${client}`).first();
      if ((await button.count()) > 0) {
        await button.click().catch(() => {});
        retried = true;
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
  options: { cycle?: boolean; permissions?: string[]; light?: boolean; first?: boolean; viewerB?: boolean } = {}
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
  await openPane(a, "a", uniqueRoom, { cycle: options.cycle, light: options.light, first: options.first });
  await openPane(b, "b", uniqueRoom, {
    cycle: options.cycle,
    light: options.light,
    first: options.first,
    role: options.viewerB ? "viewer" : undefined,
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

/** Switch the pane to the canvas view. */
async function toCanvas(page: Page, client: "a" | "b"): Promise<void> {
  await switchPaneView(page, client, "canvas");
}

/** The pane's canvas view element. */
const canvasView = (page: Page, client: "a" | "b") =>
  page.locator(`[data-testid="doc-${client}"] [data-slot="docblocks/canvas-view"]`);

/** The canvas view's center point (the 100% zoom / no pan anchor). */
async function canvasCenter(page: Page, client: "a" | "b"): Promise<{ x: number; y: number }> {
  const box = (await canvasView(page, client).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A canvas point at 100% zoom / no pan stands at the center + the offset. */
function screenAt(center: { x: number; y: number }, x: number, y: number): { x: number; y: number } {
  return { x: center.x + x, y: center.y + y };
}

/** A canvas point at an arbitrary zoom / no pan stands at the center + the scaled offset. */
function screenAtZoom(center: { x: number; y: number }, x: number, y: number, zoom: number): { x: number; y: number } {
  return { x: center.x + x * zoom, y: center.y + y * zoom };
}

/** The pane's wire log's outbound-update count (the wire log's `] out` entries). */
async function outCount(page: Page, client: "a" | "b"): Promise<number> {
  const text = await page.getByTestId(`wire-${client}`).innerText();
  return text.match(/\] out \d+B/g)?.length ?? 0;
}

/**
 * Seed a shape into the pane's first surface (created when the doc has
 * none) with the attrs + geometry and return its id.
 */
async function seedShape(
  page: Page,
  client: "a" | "b",
  attrs: Record<string, unknown> = { variant: "rect" },
  geometry: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: 240, h: 120 }
): Promise<string> {
  return page.evaluate(
    ({ client, attrs, geometry }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) throw new Error("the pane's doc is not mounted");
      const json = doc.toJSON();
      const surfaceId = Object.entries(json.blocks).find(([, block]) => block.type === "surface")?.[0];
      const surface = surfaceId !== undefined ? surfaceId : doc.insertBlock("surface");
      const id = doc.insertBlock("shape", attrs, { parent: surface });
      doc.setGeometry(id, geometry);
      return id;
    },
    { client, attrs, geometry }
  );
}

/** The pane doc's blocks with their geometries (the specs read the seed / move / resize results). */
async function blockShapes(
  page: Page,
  client: "a" | "b"
): Promise<Record<string, { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }>> {
  return page.evaluate(
    ({ client }) => {
      const docs = window.__paneDocs;
      const doc = (client === "a" ? docs?.a : docs?.b) ?? null;
      if (doc === null) return {};
      const json = doc.toJSON();
      const out: Record<
        string,
        { type: string; geometry: { x: number; y: number; w: number; h: number } | undefined }
      > = {};
      for (const [id, block] of Object.entries(json.blocks)) {
        const entry = block as { type: string; geometry?: { x: number; y: number; w: number; h: number } };
        out[id] = { type: entry.type, geometry: entry.geometry };
      }
      return out;
    },
    { client }
  );
}

/** The engine's browser name (the clipboard stand's selector). */
function browserNameOf(page: Page): string {
  return page.context().browser()?.browserType().name() ?? "chromium";
}

/**
 * The clipboard's grant over the engine's stand: the chromium's read + write;
 * the webkit's read; the firefox stands no clipboard's grant (Playwright
 * exposes no clipboard permission there — its read API takes none).
 */
async function grantClipboardPermissions(context: BrowserContext): Promise<void> {
  const name = context.browser()?.browserType().name() ?? "chromium";
  if (name === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  else if (name === "webkit") await context.grantPermissions(["clipboard-read"]);
}

/**
 * Seed the page's paste payload: the OS clipboard's write over the chromium
 * (the grant's stand), the page-global's stash over the firefox/webkit (the
 * clipboard's read stands no grantable permission there — the paste's
 * dispatch reads the stash).
 */
async function seedClipboardPayload(page: Page, payload: { html?: string; plain?: string }): Promise<void> {
  if (browserNameOf(page) === "chromium") {
    await page.evaluate(async (p) => {
      const obj: Record<string, Blob> = {};
      if (p.html !== undefined) obj["text/html"] = new Blob([p.html], { type: "text/html" });
      if (p.plain !== undefined) obj["text/plain"] = new Blob([p.plain], { type: "text/plain" });
      await navigator.clipboard.write([new ClipboardItem(obj)]);
    }, payload);
    return;
  }
  await page.evaluate((p) => {
    window.__pbSeed = p;
  }, payload);
}

/**
 * Install the clipboard's write capture (the app's copy's assertion over the
 * no-read engine: the firefox/webkit's clipboard read stands no grantable
 * permission). The native `copy`'s event (the selection's copy, the
 * cross-copy) and the clipboard API's write(s) (the code/table's copy) are
 * intercepted into the page-global's queue.
 */
async function interceptClipboardWrites(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (window.__pbWrites !== undefined) return;
    window.__pbWrites = [];
    document.addEventListener("copy", (event) => {
      const data = (event as ClipboardEvent).clipboardData;
      if (data === null) return;
      window.__pbWrites?.push({
        html: data.getData("text/html") || undefined,
        plain: data.getData("text/plain") || undefined,
      });
    });
    const clip = navigator.clipboard;
    const origWrite = clip.write.bind(clip);
    const origWriteText = clip.writeText.bind(clip);
    clip.write = (async (items: ClipboardItem[]) => {
      const textOf = async (type: string): Promise<string | null> => {
        const matching = items.filter((item) => item.types.includes(type));
        if (matching[0] === undefined) return null;
        return matching[0].getType(type).then((blob) => blob.text());
      };
      const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      window.__pbWrites?.push({ html: html ?? undefined, plain: plain ?? undefined });
      return origWrite(items).catch(() => undefined);
    }) as typeof clip.write;
    clip.writeText = (async (text: string) => {
      window.__pbWrites?.push({ plain: text });
      return origWriteText(text).catch(() => undefined);
    }) as typeof clip.writeText;
  });
}

/**
 * The app's last copied payload: the OS clipboard's read over the chromium
 * (the grant's stand's real pipeline), the intercepted write's capture
 * otherwise (the no-read engine's stand).
 */
async function readClipboardPayload(page: Page): Promise<{ html?: string; plain?: string }> {
  if (browserNameOf(page) === "chromium") {
    return page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      const textOf = async (type: string): Promise<string | null> => {
        const matching = items.filter((item) => item.types.includes(type));
        if (matching[0] === undefined) return null;
        return matching[0].getType(type).then((blob) => blob.text());
      };
      const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      return { html: html ?? undefined, plain: plain ?? undefined };
    });
  }
  return page.evaluate(() => {
    const writes = window.__pbWrites;
    const last = writes === undefined || writes.length === 0 ? undefined : writes[writes.length - 1];
    if (last === undefined) throw new Error("the clipboard's write is not captured (the intercept's stand)");
    return last;
  });
}

/**
 * Paste the page's paste payload (the plain and the html flavors when
 * present) into the focused element through a synthetic paste event (the
 * headless chromium's stand: it does not synthesize the paste's event). The
 * payload stands the OS clipboard's read over the chromium (the real
 * pipeline), the page-global's stash over the no-grant engines.
 */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(
    async (useOs: boolean) => {
      let html: string | null;
      let plain: string | null;
      if (useOs) {
        const items = await navigator.clipboard.read();
        const textOf = (type: string): Promise<string | null> =>
          Promise.resolve(items)
            .then((list) => list.filter((item) => item.types.includes(type)))
            .then((matching) =>
              matching[0] === undefined ? null : matching[0].getType(type).then((blob) => blob.text())
            );
        [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
      } else {
        const stashed = window.__pbSeed;
        if (stashed === undefined) throw new Error("the paste payload is not seeded (the seed's stash's stand)");
        html = stashed.html ?? null;
        plain = stashed.plain ?? null;
      }
      const target = document.activeElement;
      if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
      const transfer = new DataTransfer();
      if (html !== null) transfer.setData("text/html", html);
      if (plain !== null) transfer.setData("text/plain", plain);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: transfer });
      target.dispatchEvent(event);
    },
    browserNameOf(page) === "chromium"
  );
}

export {
  RELAY,
  SETTLE,
  blockShapes,
  browserNameOf,
  canvasCenter,
  canvasView,
  editorContext,
  grantClipboardPermissions,
  interceptClipboardWrites,
  insertBlockType,
  openPane,
  outCount,
  pane,
  pasteFromClipboard,
  readClipboardPayload,
  screenAt,
  screenAtZoom,
  seedClipboardPayload,
  seedShape,
  switchPaneView,
  toCanvas,
  twoPanes,
};
export type { PaneDoc };
