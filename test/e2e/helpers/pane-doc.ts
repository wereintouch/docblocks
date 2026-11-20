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
  meta: {
    id: string;
    title: string;
    avatar?: string;
    createdAt?: string;
    attributes?: Record<string, unknown>;
    attributesOrder?: string[];
  };
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
  setAttribute(key: string, value: unknown): void;
  removeAttribute(key: string): void;
  renameAttribute(fromKey: string, toKey: string): void;
  reorderAttributes(order: string[]): void;
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

export type { MasterDoc, PaneDoc };
