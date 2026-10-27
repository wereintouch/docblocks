import type { Page } from "@playwright/test";

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
      createTable(name: string, options?: { system?: boolean }): Promise<string>;
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
      describeTable(
        tableId: string
      ): Promise<{ name: string; columns: { id: string; name: string; type: string; refTableId?: string }[] }>;
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
 * for the database, `children` for containers).
 */
interface PaneBlock {
  type: string;
  attrs?: Record<string, unknown>;
  content?: { text: string; marks: Record<string, unknown> }[];
  children?: string[];
  rows?: Record<string, Record<string, unknown>>;
  rowOrder?: string[];
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

export { insertBlockType, switchPaneView };
