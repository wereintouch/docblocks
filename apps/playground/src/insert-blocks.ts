import { createMemoryBlobStore } from "docblocks-react-ui";
import type { BlobRef, BlobStore, BridgeColumn, DatabaseBridge } from "docblocks-react-ui";

import type { BlockId, DatabaseAttrs, Doc } from "docblocks-core";

import { MASTER_SUBTREE_BLOCK_ID } from "./master";
import { databaseBridgeReady, persistentDatabaseBridge } from "./persistent-bridge";

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

/** The fixed embed src the harness inserts (a one-line html page). */
const EMBED_SRC = "data:text/html," + encodeURIComponent("<html><body><p>embedded page</p></body></html>");

/** The seed diagram the harness inserts with a mermaid code block (harness convenience; the user edits it in the block). */
const MERMAID_SEED = "graph TD\n A --> B";

/** The fixed unknown docId the broken sync-embed option references. */
const MISSING_MASTER_ID = "missing-master";

/** The persistent bridge's demo tables (the seed converges the standing state to the canonical demo tables — an idempotent upsert over the persisted snapshot's restore: the tables adopt by the name's slug, a duplicate column's create adopts the standing column, the rows stand the pk-value insertion (the same id adopts the row — no loss); the missing system table / columns / rows are created, and a legacy enum's column — the static select's options stand, no ref — stands the ref's update). The e2e bridge suite and the slash picker demo read from it. */
void (async () => {
  // The persisted snapshot's seed stands first (the upsert reads the
  // snapshot's tables, not the empty bridge).
  await databaseBridgeReady();
  const bridge = persistentDatabaseBridge;
  // The duplicate-column create's refusal is the adoption stand (the peer
  // tab's concurrent seed or the standing column already stands it).
  const ensureColumn = (tableId: string, column: BridgeColumn) => bridge.createColumn(tableId, column).catch(() => {});
  // The enum's options' system table (the hidden stand — the `listTables`
  // stands it out; the options' rows over the `name` / the `color`
  // columns, the pk IS the option's value — the legacy dict's stand
  // keeps the demo's cell values intact).
  await bridge.createTable("Statuses-enum", { system: true });
  ensureColumn("table-statuses-enum", { id: "name", name: "name", type: "text" });
  ensureColumn("table-statuses-enum", { id: "color", name: "color", type: "text" });
  await bridge.insertRows("table-statuses-enum", [
    { id: "todo", name: "todo", color: "#f4e07d" },
    { id: "doing", name: "doing", color: "#93b4f2" },
    { id: "done", name: "done", color: "#97e3a8" },
  ]);
  const demoId = await bridge.createTable("Demo");
  await ensureColumn(demoId, { id: "title", name: "Title", type: "text" });
  await ensureColumn(demoId, { id: "count", name: "Count", type: "integer" });
  await ensureColumn(demoId, { id: "done", name: "Done", type: "boolean" });
  await ensureColumn(demoId, {
    id: "status",
    name: "Status",
    type: "text",
    refKind: "enum",
    refTableId: "table-statuses-enum",
  });
  // The legacy status's column (the static select's options stand, no ref)
  // adopts the enum's ref — the upsert's update over the standing column;
  // the current-form's column stands the no-op's guard (the re-update is
  // the peer-tab's echo stand, adopted).
  const { columns } = await bridge.describeTable(demoId);
  const statusColumn = columns.find((column) => column.id === "status");
  if (
    statusColumn !== undefined &&
    (statusColumn.refKind !== "enum" || statusColumn.refTableId !== "table-statuses-enum")
  ) {
    await bridge
      .updateColumn(demoId, "status", {
        type: "text",
        refKind: "enum",
        refTableId: "table-statuses-enum",
      })
      .catch(() => {});
  }
  await bridge.insertRows(demoId, [
    { id: "demo-1", title: "First task", count: 1, done: false, status: "todo" },
    { id: "demo-2", title: "Second task", count: 2, done: true, status: "done" },
    { id: "demo-3", title: "Third task", count: 3, done: false, status: "doing" },
  ]);
  // The catalog's table (the external form's stand — the catalog doc's
  // database block references it; the deterministic id's stand over the
  // JSON golden's byte-stability).
  const catalogId = await bridge.createTable("Catalog-demo");
  await ensureColumn(catalogId, { id: "name", name: "Name", type: "text" });
  await ensureColumn(catalogId, { id: "done", name: "Done", type: "boolean" });
  await ensureColumn(catalogId, {
    id: "status",
    name: "Status",
    type: "text",
    refKind: "enum",
    refTableId: "table-statuses-enum",
  });
  await bridge.insertRows(catalogId, [
    { id: "cat-1", name: "First task", done: false, status: "todo" },
    { id: "cat-2", name: "Second task", done: true, status: "done" },
  ]);
  // A second demo table with a spread of PostgreSQL types (the per-type
  // cell editors / filter inputs read from it; the e2e suite only reads
  // the demo table, so this stays purely a dev-harness fixture).
  const projectsId = await bridge.createTable("Projects");
  await ensureColumn(projectsId, { id: "code", name: "Code", type: "text" });
  await ensureColumn(projectsId, { id: "budget", name: "Budget", type: "double precision" });
  await ensureColumn(projectsId, { id: "progress", name: "Progress", type: "numeric" });
  await ensureColumn(projectsId, { id: "started", name: "Started", type: "date" });
  await ensureColumn(projectsId, { id: "deadline", name: "Deadline", type: "timestamptz" });
  await ensureColumn(projectsId, { id: "archived", name: "Archived", type: "boolean" });
  await bridge.insertRows(projectsId, [
    {
      id: "prj-1",
      code: "PRJ-1",
      budget: 12000,
      progress: 0.75,
      started: "2026-09-01",
      deadline: "2026-12-15T18:00",
      archived: false,
    },
    {
      id: "prj-2",
      code: "PRJ-2",
      budget: 8500,
      progress: 0.2,
      started: "2026-10-01",
      deadline: "2027-01-20T09:30",
      archived: false,
    },
    {
      id: "prj-3",
      code: "PRJ-3",
      budget: 4300,
      progress: 1,
      started: "2026-08-12",
      deadline: "2026-10-31T12:00",
      archived: true,
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

/** The canvas demo scene the harness inserts (harness convenience): the fixed geometries, one surface with a frame (seeded with a heading + a paragraph), four shapes (the rounded one texted — the shape text's stand), a canvas-text, and a connector between the frame and the rect. */
function seedCanvas(doc: Doc): BlockId {
  const surface = doc.insertBlock("surface");
  doc.setGeometry(surface, { x: 0, y: 0, w: 900, h: 500 });
  const frame = doc.insertBlock("frame", undefined, { parent: surface });
  doc.setGeometry(frame, { x: -180, y: -100, w: 280, h: 160 });
  const heading = doc.insertBlock("heading", { level: 2 }, { parent: frame });
  doc.insertText(heading, 0, "Frame heading");
  const paragraph = doc.insertBlock("paragraph", undefined, { parent: frame });
  doc.insertText(paragraph, 0, "Frame paragraph on the canvas.");
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
  const note = doc.insertBlock("canvas-text", undefined, { parent: surface });
  doc.insertText(note, 0, "Canvas note");
  doc.setGeometry(note, { x: 140, y: -140, w: 200, h: 40 });
  // The connector is the topmost element (the z-order last): from the
  // frame's center to the rect's center.
  doc.insertBlock(
    "connector",
    { start: { blockId: frame }, end: { blockId: rect }, label: "relates to" },
    { parent: surface }
  );
  return surface;
}

/** Fixed key -> inline data: URL (a small SVG data URI). */
const BLOB_SOURCES: Record<string, string> = {
  [IMAGE_KEY]:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' fill='#0969da'/></svg>"
    ),
};

/** The in-memory half of the harness's blob store (the slash Image uploads). */
const memoryBlobs = createMemoryBlobStore();

/**
 * The harness's blob store: the fixed keys above (the catalog image),
 * then the in-memory uploads (one per page — the A/B panes share it).
 */
const blobStore: BlobStore = {
  resolve: async (key: string): Promise<BlobRef> => {
    const url = BLOB_SOURCES[key];
    if (url !== undefined) return { url, meta: { subtype: "image" } };
    return memoryBlobs.resolve(key);
  },
  upload: (file, meta) => memoryBlobs.upload(file, meta),
  remove: (key) => memoryBlobs.remove?.(key) ?? Promise.resolve(),
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
        id = doc.insertBlock("embed", { kind: "iframe", src: EMBED_SRC });
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
        id = seedCanvas(doc);
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
  databaseBridge,
  EMBED_SRC,
  insertBlockOf,
  INSERTABLE_TYPES,
  seedCanvas,
  seedCatalogDatabase,
  seedDatabase,
};
export type { InsertableType };
