import { type Browser, type Page, expect } from "@playwright/test";

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
    __bridge?: {
      listTables(): Promise<{ id: string; name: string }[]>;
      createTable(name: string, options?: { system?: boolean; id?: string }): Promise<string>;
      renameTable(tableId: string, name: string): Promise<void>;
      createColumn(
        tableId: string,
        column: {
          id: string;
          name: string;
          type: string;
          options?: string[];
          refKind?: "enum" | "row";
          refMany?: boolean;
          refTableId?: string;
        }
      ): Promise<void>;
      insertRows(tableId: string, rows: Record<string, unknown>[]): Promise<string[]>;
      insertRow(tableId: string, row: Record<string, unknown>): Promise<string>;
      moveRow(tableId: string, rowId: string, beforeRowId: string | null): Promise<void>;
      describeTable(tableId: string): Promise<{
        name: string;
        columns: { id: string; name: string; type: string; refKind?: "enum" | "row"; refTableId?: string }[];
      }>;
      queryRows(
        tableId: string,
        query?: { filter?: unknown; orderBy?: string[]; cursor?: string; limit?: number }
      ): Promise<{ rows: Record<string, Record<string, unknown>>; nextCursor: string | null }>;
      updateRow(tableId: string, rowId: string, cells: Record<string, unknown>): Promise<void>;
    };
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
 * two).
 */
async function openPane(
  page: Page,
  client: "a" | "b",
  room: string,
  options: { cycle?: boolean; settle?: { timeout: number }; url?: string; light?: boolean; first?: boolean } = {}
): Promise<void> {
  const url = options.url ?? `/?client=${client}&syncUrl=${RELAY}/${room}${options.cycle ? "&cycle=1" : ""}`;
  await page.goto(url);
  const status = options.first ? page.getByTestId(`status-${client}`).first() : page.getByTestId(`status-${client}`);
  await expect(status).toHaveText("connected", options.settle ?? { timeout: 15_000 });
  if (options.light) {
    await page.evaluate(() => document.documentElement.classList.remove("dark"));
  }
}

/**
 * Two relay panes in isolated browser contexts (the a / b clients on one
 * room; the room gets a per-run suffix so a shared room never stands
 * polluted across spec files).
 */
async function twoPanes(
  browser: Browser,
  room: string,
  options: { cycle?: boolean; permissions?: string[]; light?: boolean; first?: boolean } = {}
): Promise<{ a: Page; b: Page; close: () => Promise<void> }> {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  if (options.permissions) {
    await contextA.grantPermissions(options.permissions);
    await contextB.grantPermissions(options.permissions);
  }
  const a = await contextA.newPage();
  const b = await contextB.newPage();
  const uniqueRoom = `${room}-${Math.random().toString(36).slice(2, 8)}`;
  await openPane(a, "a", uniqueRoom, { cycle: options.cycle, light: options.light, first: options.first });
  await openPane(b, "b", uniqueRoom, { cycle: options.cycle, light: options.light, first: options.first });
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

/**
 * Paste the clipboard's text (the plain and the html flavors when present)
 * into the focused element through a synthetic paste event.
 */
async function pasteFromClipboard(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const textOf = (type: string): Promise<string | null> =>
      Promise.resolve(items)
        .then((list) => list.filter((item) => item.types.includes(type)))
        .then((matching) => (matching[0] === undefined ? null : matching[0].getType(type).then((blob) => blob.text())));
    const [html, plain] = await Promise.all([textOf("text/html"), textOf("text/plain")]);
    const target = document.activeElement;
    if (!(target instanceof HTMLElement)) throw new Error("the paste target should be focused");
    const transfer = new DataTransfer();
    if (html !== null) transfer.setData("text/html", html);
    if (plain !== null) transfer.setData("text/plain", plain);
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
    target.dispatchEvent(event);
  });
}

export {
  RELAY,
  SETTLE,
  blockShapes,
  canvasCenter,
  canvasView,
  insertBlockType,
  openPane,
  outCount,
  pane,
  pasteFromClipboard,
  screenAt,
  screenAtZoom,
  seedShape,
  switchPaneView,
  toCanvas,
  twoPanes,
};
export type { PaneDoc };
