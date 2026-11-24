import type { BlockId, Doc } from "docblocks-core";

import { IMAGE_KEY } from "./blob-fixtures";
import { seedDatabase } from "./database-seed";
import { seedCanvas } from "./insert-canvas-demo";
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
  "code-mermaid-large",
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

/** The fixed embed src the harness inserts (a one-line html page — the
 * `html` kind's data URL snippet, the write gate's only data-scheme stand). */
const EMBED_SRC = "data:text/html," + encodeURIComponent("<html><body><p>embedded page</p></body></html>");

/** The seed diagram the harness inserts with a mermaid code block (harness convenience; the user edits it in the block). */
const MERMAID_SEED = "graph TD\n A --> B";

/** The tall's multi-branch graph the harness inserts with the `code-mermaid-large` type (the large diagram's evaluation's stand — the viewport's pan/zoom + the height's resize). */
const MERMAID_SEED_LARGE = `graph TD
  A[User story] --> B{Priority?}
  B -->|High| C[Design review]
  B -->|Low| D[Backlog]
  C --> E[Implementation]
  D --> E
  E --> F{Code review?}
  F -->|Pass| G[Integration]
  F -->|Fail| E
  G --> H{QA?}
  H -->|Pass| I[Release candidate]
  H -->|Fail| J[Bug triage]
  J --> E
  I --> K[Rollout plan]
  K --> L[Deploy: staging]
  L --> M[Smoke tests]
  M --> N[Deploy: production]
  N --> O[Monitoring]
  O --> P{Incident?}
  P -->|No| Q[Done]
  P -->|Yes| J`;

/** The fixed unknown docId the broken sync-embed option references. */
const MISSING_MASTER_ID = "missing-master";

/**
 * Insert one block of `type` at the root with the harness attrs (heading
 * level 2, list-item bullet, code language "ts", code-mermaid a code block
 * with language "mermaid" and the seed diagram (code-mermaid-large the
 * tall's multi-branch graph), image the
 * fixed key, embed the fixed data: URL, sync-embed the ref to the pane's
 * master doc (the subtree variant narrows it to the seeded subtree
 * paragraph, the broken one a fixed unknown docId); a table comes
 * prebuilt 2x2 with a paragraph in every cell. The insert is one
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
      case "code-mermaid-large":
        id = doc.insertBlock("code", { language: "mermaid" });
        doc.insertText(id, 0, MERMAID_SEED_LARGE);
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

export { EMBED_SRC, INSERTABLE_TYPES, insertBlockOf };
export type { InsertableType };
