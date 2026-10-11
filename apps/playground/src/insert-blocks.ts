import type { BlockId, Doc } from "docblocks-core";

/** The v1 page block types the harness insert control offers (top level). */
const INSERTABLE_TYPES = [
  "paragraph",
  "heading",
  "callout",
  "list-item",
  "code",
  "latex",
  "table",
  "image",
  "embed",
  "divider",
] as const;

type InsertableType = (typeof INSERTABLE_TYPES)[number];

/** The fixed image key the harness inserts; its src is a small inline SVG. */
const IMAGE_KEY = "demo-image";

/** The fixed embed src the harness inserts (a one-line html page). */
const EMBED_SRC = "data:text/html," + encodeURIComponent("<html><body><p>embedded page</p></body></html>");

/** Fixed key -> inline data: URL (a small SVG data URI). */
const BLOB_SOURCES: Record<string, string> = {
  [IMAGE_KEY]:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='80'><rect width='120' height='80' fill='#0969da'/></svg>"
    ),
};

/** The harness's blob resolver: the fixed keys above, "" for unknown keys. */
function blobResolver(key: string): string {
  return BLOB_SOURCES[key] ?? "";
}

/**
 * Insert one block of `type` at the root with the harness attrs (heading
 * level 2, list-item bullet, code language "ts", latex display, image the
 * fixed key, embed the fixed data: URL; a table comes prebuilt 2x2 with a
 * paragraph in every cell). The insert is one transaction: one undo step
 * and one wire update.
 */
function insertBlockOf(type: InsertableType, doc: Doc): BlockId {
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
      case "latex":
        id = doc.insertBlock("latex", { display: true });
        break;
      case "image":
        id = doc.insertBlock("image", { src: IMAGE_KEY });
        break;
      case "embed":
        id = doc.insertBlock("embed", { kind: "iframe", src: EMBED_SRC });
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

export { blobResolver, EMBED_SRC, insertBlockOf, INSERTABLE_TYPES };
export type { InsertableType };
