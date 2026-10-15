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
  toJSON(): {
    id: string;
    blocks: Record<string, PaneBlock>;
  };
  getChildren(id: string): string[];
  getBlock(id: string): PaneBlock | null;
  insertBlock(type: string, attrs?: Record<string, unknown>, position?: { parent?: string; after?: string }): string;
  insertText(blockId: string, pos: number, text: string, marks?: Record<string, unknown>): void;
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
  setGeometry(id: string, geometry: { x?: number; y?: number; w?: number; h?: number; rotation?: number } | null): void;
  setMark(blockId: string, from: number, to: number, mark: unknown): void;
  transact(fn: () => void): void;
}

/** The pane's master doc (the sync-embed target) — the structural surface the specs may read/drive (the mounted global is the full core `Doc`). */
interface MasterDoc extends PaneDoc {
  meta: { id: string };
}

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

export { insertBlockType };
