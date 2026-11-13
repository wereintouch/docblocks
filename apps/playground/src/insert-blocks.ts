import { createMemoryBlobStore } from "docblocks-react-ui";
import type { BlobRef, BlobStore, CellMap, Column, DatabaseBridge } from "docblocks-react-ui";

import type { BlockId, DatabaseAttrs, Doc } from "docblocks-core";

import { MASTER_SUBTREE_BLOCK_ID } from "./master";
import { databaseBridgeReady, newMutationContext, persistentDatabaseBridge } from "./persistent-bridge";

/** The v1 page block types the harness insert control offers (top level). */
const INSERTABLE_TYPES = [
  "paragraph",
  "heading",
  "quote",
  "callout",
  "list-item",
  "code",
  "code-mermaid",
  "table",
  "image",
  "embed",
  "sync-embed",
  "sync-embed-subtree",
  "sync-embed-broken",
  "database",
  "canvas",
  "divider",
] as const;

type InsertableType = (typeof INSERTABLE_TYPES)[number];

/** The fixed image key the harness inserts; its src is a small inline SVG. */
const IMAGE_KEY = "demo-image";
/** The fixed generic attachment the catalog renders. */
const CATALOG_FILE_KEY = "demo-file";

/** The fixed embed src the harness inserts (a one-line html page — the
 * `html` kind's data URL snippet, the write gate's only data-scheme stand). */
const EMBED_SRC = "data:text/html," + encodeURIComponent("<html><body><p>embedded page</p></body></html>");

/** The seed diagram the harness inserts with a mermaid code block (harness convenience; the user edits it in the block). */
const MERMAID_SEED = "graph TD\n A --> B";

/** The fixed unknown docId the broken sync-embed option references. */
const MISSING_MASTER_ID = "missing-master";

/** The table id derived from the name (the reference bridge's
 * deterministic derivation — the reload's adoption depends on it: the doc's
 * `tableId` references stand the id's survival). */
function tableIdOf(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "table";
  return `table-${slug}`;
}

/** The demo's column spec (the create's input minus the bridge-owned `id`
 * / `revision` — the helper stands the position / the nullability). */
interface DemoColumnSpec {
  name: string;
  type: string;
  reference?: { kind: "enum" | "row"; tableId: string; many: boolean };
}

/** The persistent bridge's demo tables (the seed converges the standing
 * state to the canonical demo tables — an idempotent upsert over the
 * persisted snapshot's restore: the tables adopt by the name's slug, a
 * standing column adopts by its name (the missing reference stands the
 * update's adoption), and a standing row adopts by its identifying cell's
 * value; the missing system table / columns / rows are created). The e2e
 * bridge suite and the slash picker demo read from it. */
void (async () => {
  // The persisted snapshot's seed stands first (the upsert reads the
  // snapshot's tables, not the empty bridge).
  await databaseBridgeReady();
  const bridge = persistentDatabaseBridge;

  // The adoption over the deterministic id (the create stands the fresh
  // table; the unknown id's rejection is the create's stand).
  const ensureTable = async (name: string, system = false): Promise<string> => {
    const id = tableIdOf(name);
    try {
      await bridge.describeTable(id);
      return id;
    } catch {
      // the unknown table: the create's stand
    }
    const receipt = await bridge.createTable({ name, ...(system ? { system: true } : {}) }, newMutationContext());
    return receipt.result.id;
  };

  // The standing column adopts by the name (the create's refusal — the
  // peer tab's concurrent seed or the standing column already stands it —
  // re-reads the column over the fresh describe).
  const ensureColumn = async (tableId: string, spec: DemoColumnSpec): Promise<Column> => {
    const { columns } = await bridge.describeTable(tableId);
    const standing = columns.find((entry) => entry.name === spec.name);
    if (standing !== undefined) {
      // The legacy / the ref-less standing column adopts the enum's
      // reference — the update's adoption (the concurrent echo's refusal
      // stands the column's reference anyway).
      if (spec.reference !== undefined) {
        const current = standing.reference;
        if (current?.kind !== spec.reference.kind || current?.tableId !== spec.reference.tableId) {
          try {
            await bridge.updateColumn(tableId, standing.id, { reference: spec.reference }, newMutationContext());
          } catch {
            // the concurrent adoption's refusal: the column stands the ref anyway
          }
        }
      }
      return standing;
    }
    try {
      const receipt = await bridge.createColumn(
        tableId,
        {
          column: {
            name: spec.name,
            type: spec.type,
            position: columns.length,
            nullable: true,
            ...(spec.reference !== undefined ? { reference: spec.reference } : {}),
          },
        },
        newMutationContext()
      );
      return receipt.result;
    } catch {
      const { columns: fresh } = await bridge.describeTable(tableId);
      const adopted = fresh.find((entry) => entry.name === spec.name);
      if (adopted === undefined) {
        throw new Error(`The column "${spec.name}" could not be ensured over the table "${tableId}".`);
      }
      return adopted;
    }
  };

  // The rows' idempotent upsert: a standing row adopts by its identifying
  // cell's value, the missing rows create over one atomic batch (the fresh
  // snapshot stands the fresh allocations' ids).
  const ensureRows = async (
    tableId: string,
    identifyColumnId: string,
    wanted: Array<{ key: string; cells: CellMap }>
  ): Promise<Record<string, string>> => {
    const before = await bridge.snapshotTable(tableId, {});
    const standing = new Set<string>();
    for (const row of before.page.rows) {
      const value = row.cells[identifyColumnId];
      if (typeof value === "string") standing.add(value);
    }
    const missing = wanted.filter((entry) => !standing.has(entry.key));
    if (missing.length > 0) {
      await bridge.batchRows(
        tableId,
        { ops: missing.map((entry) => ({ op: "create", row: entry.cells, beforeRowId: null })) },
        newMutationContext()
      );
    }
    const after = await bridge.snapshotTable(tableId, {});
    const ids: Record<string, string> = {};
    for (const row of after.page.rows) {
      const value = row.cells[identifyColumnId];
      if (typeof value === "string") ids[value] = row.id;
    }
    return ids;
  };

  // The enum's options' system table (the hidden stand — the `listTables`
  // stands it out; the option's row IS the option: the row id stands the
  // option's value, the `name` column the label, the `color` column the
  // chip's hex).
  const enumTableId = await ensureTable("Statuses-enum", true);
  const enumNameColumn = await ensureColumn(enumTableId, { name: "name", type: "text" });
  const enumColorColumn = await ensureColumn(enumTableId, { name: "color", type: "text" });
  const options = await ensureRows(enumTableId, enumNameColumn.id, [
    { key: "todo", cells: { [enumNameColumn.id]: "todo", [enumColorColumn.id]: "#f4e07d" } },
    { key: "doing", cells: { [enumNameColumn.id]: "doing", [enumColorColumn.id]: "#93b4f2" } },
    { key: "done", cells: { [enumNameColumn.id]: "done", [enumColorColumn.id]: "#97e3a8" } },
  ]);

  const demoId = await ensureTable("Demo");
  const titleColumn = await ensureColumn(demoId, { name: "Title", type: "text" });
  const countColumn = await ensureColumn(demoId, { name: "Count", type: "integer" });
  const doneColumn = await ensureColumn(demoId, { name: "Done", type: "boolean" });
  const statusColumn = await ensureColumn(demoId, {
    name: "Status",
    type: "text",
    reference: { kind: "enum", tableId: enumTableId, many: false },
  });
  await ensureRows(demoId, titleColumn.id, [
    {
      key: "First task",
      cells: {
        [titleColumn.id]: "First task",
        [countColumn.id]: 1,
        [doneColumn.id]: false,
        [statusColumn.id]: options["todo"] ?? null,
      },
    },
    {
      key: "Second task",
      cells: {
        [titleColumn.id]: "Second task",
        [countColumn.id]: 2,
        [doneColumn.id]: true,
        [statusColumn.id]: options["done"] ?? null,
      },
    },
    {
      key: "Third task",
      cells: {
        [titleColumn.id]: "Third task",
        [countColumn.id]: 3,
        [doneColumn.id]: false,
        [statusColumn.id]: options["doing"] ?? null,
      },
    },
  ]);

  // The catalog's table (the external form's stand — the catalog doc's
  // database block references it; the deterministic id's stand over the
  // JSON golden's byte-stability — `table-catalog-demo`, the
  // `CATALOG_TABLE_ID`'s value).
  const catalogId = await ensureTable("Catalog-demo");
  const catalogNameColumn = await ensureColumn(catalogId, { name: "Name", type: "text" });
  const catalogDoneColumn = await ensureColumn(catalogId, { name: "Done", type: "boolean" });
  const catalogStatusColumn = await ensureColumn(catalogId, {
    name: "Status",
    type: "text",
    reference: { kind: "enum", tableId: enumTableId, many: false },
  });
  await ensureRows(catalogId, catalogNameColumn.id, [
    {
      key: "First task",
      cells: {
        [catalogNameColumn.id]: "First task",
        [catalogDoneColumn.id]: false,
        [catalogStatusColumn.id]: options["todo"] ?? null,
      },
    },
    {
      key: "Second task",
      cells: {
        [catalogNameColumn.id]: "Second task",
        [catalogDoneColumn.id]: true,
        [catalogStatusColumn.id]: options["done"] ?? null,
      },
    },
  ]);

  // A second demo table with a spread of PostgreSQL types (the per-type
  // cell editors / filter inputs read from it; the e2e suite only reads
  // the demo table, so this stays purely a dev-harness fixture).
  const projectsId = await ensureTable("Projects");
  const codeColumn = await ensureColumn(projectsId, { name: "Code", type: "text" });
  const budgetColumn = await ensureColumn(projectsId, { name: "Budget", type: "double precision" });
  const progressColumn = await ensureColumn(projectsId, { name: "Progress", type: "numeric" });
  const startedColumn = await ensureColumn(projectsId, { name: "Started", type: "date" });
  const deadlineColumn = await ensureColumn(projectsId, { name: "Deadline", type: "timestamptz" });
  const archivedColumn = await ensureColumn(projectsId, { name: "Archived", type: "boolean" });
  await ensureRows(projectsId, codeColumn.id, [
    {
      key: "PRJ-1",
      cells: {
        [codeColumn.id]: "PRJ-1",
        [budgetColumn.id]: 12000,
        [progressColumn.id]: 0.75,
        [startedColumn.id]: "2026-09-01",
        [deadlineColumn.id]: "2026-12-15T18:00",
        [archivedColumn.id]: false,
      },
    },
    {
      key: "PRJ-2",
      cells: {
        [codeColumn.id]: "PRJ-2",
        [budgetColumn.id]: 8500,
        [progressColumn.id]: 0.2,
        [startedColumn.id]: "2026-10-01",
        [deadlineColumn.id]: "2027-01-20T09:30",
        [archivedColumn.id]: false,
      },
    },
    {
      key: "PRJ-3",
      cells: {
        [codeColumn.id]: "PRJ-3",
        [budgetColumn.id]: 4300,
        [progressColumn.id]: 1,
        [startedColumn.id]: "2026-08-12",
        [deadlineColumn.id]: "2026-10-31T12:00",
        [archivedColumn.id]: true,
      },
    },
  ]);
})();

/** The pane's persistent database bridge (the e2e + the dev tools drive it). */
const databaseBridge: DatabaseBridge = persistentDatabaseBridge;

/** The database seed the harness inserts (harness convenience; the user edits it in the block): the v1 inline form's contract (the rows and the columns stand in the document — the current model's types live in the bridge's external form, the catalog's stand over it). */
const DATABASE_COLUMNS: DatabaseAttrs["columns"] = [
  { id: "name", name: "Name", type: "text" },
  { id: "done", name: "Done", type: "checkbox" },
  { id: "status", name: "Status", type: "select", options: ["active", "done"] },
];

/** Seeds one database block (the seed columns + 2 rows with cell values) and returns its id. */
function seedDatabase(doc: Doc): BlockId {
  const id = doc.insertBlock("database", { columns: DATABASE_COLUMNS });
  const r1 = doc.insertRow(id);
  const r2 = doc.insertRow(id);
  doc.setCell(id, r1, "name", "First task");
  doc.setCell(id, r1, "done", false);
  doc.setCell(id, r1, "status", "active");
  doc.setCell(id, r2, "name", "Second task");
  doc.setCell(id, r2, "done", true);
  doc.setCell(id, r2, "status", "done");
  return id;
}

/** The catalog's database table (the external form's stand — the current model's types live in the bridge, not the inline form's legacy columns contract): the slug is deterministic, so the catalog doc's JSON golden (the block's `tableId` reference) stays byte-stable. */
const CATALOG_TABLE_ID = "table-catalog-demo";

/** Seeds the catalog's database block (the external form's reference to the harness' seeded `Catalog-demo` table) and returns its id. */
function seedCatalogDatabase(doc: Doc): BlockId {
  return doc.insertBlock("database", { tableId: CATALOG_TABLE_ID });
}

/**
 * The canvas demo scene the harness inserts (harness convenience): the
 * fixed geometries, one surface with two frames (the viewport windows —
 * the childless box's stand; the window's content is the surface's own
 * content, clipped to the box), four shapes (the rounded one texted —
 * the shape text's stand), a canvas-text (the font attrs' stand), and a
 * connector between frame A and the rect.
 */
function seedCanvas(doc: Doc): { surface: BlockId; frame: BlockId } {
  const surface = doc.insertBlock("surface");
  doc.setGeometry(surface, { x: 0, y: 0, w: 900, h: 500 });
  // Frame A: the window box over the rounded shape + the note (the
  // window's content stand — the figures stand through the window) and
  // the connector's start endpoint.
  const frame = doc.insertBlock("frame", { title: "Frame A" }, { parent: surface });
  doc.setGeometry(frame, { x: 120, y: -100, w: 320, h: 160 });
  // Frame B: the second window at a disjoint empty box (the dot grid's
  // stand; the slash picker's list stand).
  const frameB = doc.insertBlock("frame", { title: "Frame B" }, { parent: surface });
  doc.setGeometry(frameB, { x: 320, y: 90, w: 200, h: 120 });
  const rect = doc.insertBlock("shape", { variant: "rect", fill: "rgba(9, 105, 218, 0.2)" }, { parent: surface });
  doc.setGeometry(rect, { x: -120, y: 90, w: 160, h: 80 });
  const ellipse = doc.insertBlock("shape", { variant: "ellipse" }, { parent: surface });
  doc.setGeometry(ellipse, { x: 40, y: 90, w: 100, h: 80 });
  const diamond = doc.insertBlock("shape", { variant: "diamond" }, { parent: surface });
  doc.setGeometry(diamond, { x: 160, y: 40, w: 90, h: 90 });
  const rounded = doc.insertBlock(
    "shape",
    {
      variant: "rounded",
      text: "Shape text",
      fontSize: 16,
      fontFamily: "Inter",
      textStyle: "semibold",
      textAlign: "center",
    },
    { parent: surface }
  );
  doc.setGeometry(rounded, { x: 60, y: -60, w: 160, h: 60 });
  // The canvas-text's font attrs' stand (the shape text's parity).
  const note = doc.insertBlock("canvas-text", { textColor: "#b45309", textStyle: "semibold" }, { parent: surface });
  doc.insertText(note, 0, "Canvas note");
  doc.setGeometry(note, { x: 140, y: -140, w: 200, h: 40 });
  // The connector is the topmost element (the z-order last): from the
  // frame's center to the rect's center.
  doc.insertBlock(
    "connector",
    { start: { blockId: frame }, end: { blockId: rect }, label: "relates to" },
    { parent: surface }
  );
  return { surface, frame };
}

/** Fixed file id -> the catalog image's bytes and metadata. */
const BLOB_REFS: Record<string, BlobRef> = {
  [IMAGE_KEY]: {
    blob: new Blob(
      [
        "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' fill='#0969da'/></svg>",
      ],
      { type: "image/svg+xml" }
    ),
    meta: { name: "catalog.svg", mimeType: "image/svg+xml" },
  },
  [CATALOG_FILE_KEY]: {
    blob: new Blob(["Catalog attachment"], { type: "text/plain" }),
    meta: { name: "catalog.txt", mimeType: "text/plain" },
  },
};

/** The in-memory half of the harness's blob store (the slash Image uploads). */
const memoryBlobs = createMemoryBlobStore();

/**
 * The harness's blob store: the fixed keys above (the catalog image),
 * then the in-memory uploads (one per page — the A/B panes share it).
 */
const blobStore: BlobStore = {
  get: async (fileId): Promise<BlobRef> => {
    return BLOB_REFS[fileId] ?? memoryBlobs.get(fileId);
  },
  upload: (file) => memoryBlobs.upload(file),
  rename: (fileId, name) => memoryBlobs.rename(fileId, name),
  subscribe: (fileId, onChange) => memoryBlobs.subscribe(fileId, onChange),
  remove: (fileId) => memoryBlobs.remove?.(fileId) ?? Promise.resolve(),
};

/**
 * Insert one block of `type` at the root with the harness attrs (heading
 * level 2, list-item bullet, code language "ts", code-mermaid a code block
 * with language "mermaid" and the seed diagram, image the
 * fixed key, embed the fixed data: URL, sync-embed the ref to the pane's
 * master doc (the subtree variant narrows it to the seeded subtree
 * paragraph, the broken one a fixed unknown docId); a table comes
 * prebuilt 2x2 with a paragraph in every cell). The insert is one
 * transaction: one undo step and one wire update.
 */
function insertBlockOf(type: InsertableType, doc: Doc, masterDocId: string): BlockId {
  let id = "";
  doc.transact(() => {
    switch (type) {
      case "heading":
        id = doc.insertBlock("heading", { level: 2 });
        break;
      case "list-item":
        id = doc.insertBlock("list-item", { list: "bullet" });
        break;
      case "code":
        id = doc.insertBlock("code", { language: "ts" });
        break;
      case "code-mermaid":
        id = doc.insertBlock("code", { language: "mermaid" });
        doc.insertText(id, 0, MERMAID_SEED);
        break;
      case "image":
        id = doc.insertBlock("image", { src: IMAGE_KEY });
        break;
      case "embed":
        id = doc.insertBlock("embed", { kind: "html", src: EMBED_SRC });
        break;
      case "sync-embed":
        id = doc.insertBlock("sync-embed", { ref: { docId: masterDocId } });
        break;
      case "sync-embed-subtree":
        id = doc.insertBlock("sync-embed", { ref: { docId: masterDocId, blockId: MASTER_SUBTREE_BLOCK_ID } });
        break;
      case "sync-embed-broken":
        id = doc.insertBlock("sync-embed", { ref: { docId: MISSING_MASTER_ID } });
        break;
      case "database":
        id = seedDatabase(doc);
        break;
      case "canvas":
        id = seedCanvas(doc).surface;
        break;
      case "table": {
        const tableId = doc.insertBlock("table", { cols: 2 });
        for (let row = 0; row < 2; row++) {
          const rowId = doc.insertBlock("table-row", undefined, { parent: tableId });
          for (let cell = 0; cell < 2; cell++) {
            const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
            doc.insertBlock("paragraph", undefined, { parent: cellId });
          }
        }
        id = tableId;
        break;
      }
      default:
        id = doc.insertBlock(type);
    }
  });
  return id;
}

export {
  blobStore,
  CATALOG_FILE_KEY,
  databaseBridge,
  EMBED_SRC,
  insertBlockOf,
  INSERTABLE_TYPES,
  seedCanvas,
  seedCatalogDatabase,
  seedDatabase,
};
export type { InsertableType };
