import { createMemoryBlobStore, getDefaultDatabaseBridge } from "docblocks-react-ui";
import type { BlobRef, BlobStore, DatabaseBridge } from "docblocks-react-ui";

import type { BlockId, DatabaseAttrs, Doc } from "docblocks-core";

import { MASTER_SUBTREE_BLOCK_ID } from "./master";

/** The v1 page block types the harness insert control offers (top level). */
const INSERTABLE_TYPES = [
  "paragraph",
  "heading",
  "quote",
  "callout",
  "list-item",
  "code",
  "code-mermaid",
  "latex",
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

/** The default bridge's demo table (seeded once per page / per channel —
 *  the seed skips when a "Demo" table stands: the other pane's or the
 *  other tab's seed, synced by the bridge's event echo). */

// The default bridge's demo table: seeded once per page / per channel
// (the name-aware guard: the other pane's / tab's seed stands, the event
// echo keeps the state shared). The e2e bridge suite and the slash picker
// demo read from it.
void (async () => {
  const bridge = getDefaultDatabaseBridge();
  if ((await bridge.listTables()).some((table) => table.name === "Demo")) return;
  const demoId = await bridge.createTable("Demo");
  await bridge.createColumn(demoId, { id: "title", name: "Title", type: "text" });
  await bridge.createColumn(demoId, { id: "count", name: "Count", type: "integer" });
  await bridge.createColumn(demoId, { id: "done", name: "Done", type: "boolean" });
  await bridge.createColumn(demoId, {
    id: "status",
    name: "Status",
    type: "text",
    options: ["todo", "doing", "done"],
  });
  await bridge.insertRows(demoId, [
    { title: "First task", count: 1, done: false, status: "todo" },
    { title: "Second task", count: 2, done: true, status: "done" },
    { title: "Third task", count: 3, done: false, status: "doing" },
  ]);
  // A second demo table with a spread of PostgreSQL types (the per-type
  // cell editors / filter inputs read from it; the e2e suite only reads
  // the demo table, so this stays purely a dev-harness fixture).
  const projectsId = await bridge.createTable("Projects");
  await bridge.createColumn(projectsId, { id: "code", name: "Code", type: "text" });
  await bridge.createColumn(projectsId, { id: "budget", name: "Budget", type: "double precision" });
  await bridge.createColumn(projectsId, { id: "progress", name: "Progress", type: "numeric" });
  await bridge.createColumn(projectsId, { id: "started", name: "Started", type: "date" });
  await bridge.createColumn(projectsId, { id: "deadline", name: "Deadline", type: "timestamptz" });
  await bridge.createColumn(projectsId, { id: "archived", name: "Archived", type: "boolean" });
  await bridge.insertRows(projectsId, [
    {
      code: "PRJ-1",
      budget: 12000,
      progress: 0.75,
      started: "2026-09-01",
      deadline: "2026-12-15T18:00",
      archived: false,
    },
    {
      code: "PRJ-2",
      budget: 8500,
      progress: 0.2,
      started: "2026-10-01",
      deadline: "2027-01-20T09:30",
      archived: false,
    },
    {
      code: "PRJ-3",
      budget: 4300,
      progress: 1,
      started: "2026-08-12",
      deadline: "2026-10-31T12:00",
      archived: true,
    },
  ]);
})();

/** The pane's default database bridge (the e2e + the dev tools drive it). */
const databaseBridge: DatabaseBridge = getDefaultDatabaseBridge();

/** The database seed the harness inserts (harness convenience; the user edits it in the block). */
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
 * with language "mermaid" and the seed diagram, latex display, image the
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
      case "latex":
        id = doc.insertBlock("latex", { display: true });
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

export { blobStore, databaseBridge, EMBED_SRC, insertBlockOf, INSERTABLE_TYPES, seedCanvas, seedDatabase };
export type { InsertableType };
