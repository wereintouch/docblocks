import { type Doc, type MarkSet, createDoc } from "docblocks-core";

import { EMBED_SRC, seedDatabase } from "./insert-blocks";
import { CATALOG_MASTER_ID } from "./master";

/** The fixed pane doc identity (the e2e room/doc conventions rely on it). */
const DOC_ID = "d1";
const DOC_CREATED_AT = "2026-01-01T00:00:00Z";

/** The fixed image key the catalog uses (the harness's blob map resolves it to a data: URL). */
const CATALOG_IMAGE_KEY = "demo-image";

/** Heading levels 1..6, one block each. */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

/**
 * The marks paragraph's fixed run layout: a plain run, one run per
 * non-exclusive mark, the combined bold+italic run, then the exclusive code
 * and math runs (math's tex matches its text, so the flat offsets stay sane).
 */
const MARKS_LAYOUT: { text: string; marks: MarkSet }[] = [
  { text: "plain ", marks: {} },
  { text: "bold ", marks: { bold: true } },
  { text: "italic ", marks: { italic: true } },
  { text: "strike ", marks: { strike: true } },
  { text: "underline ", marks: { underline: true } },
  { text: "link ", marks: { link: { href: "https://example.com" } } },
  { text: "color ", marks: { color: { value: "#cf222e" } } },
  { text: "highlight ", marks: { highlight: { value: "#ffdd00" } } },
  { text: "bold italic ", marks: { bold: true, italic: true } },
  { text: "code ", marks: { code: true } },
  { text: "x^2", marks: { math: { tex: "x^2" } } },
];

declare global {
  interface Window {
    /** Harness-only: the catalog pane's live doc (null when not a catalog pane); the e2e suite reads its toJSON() as the JSON golden. */
    __catalogDoc?: Doc | null;
  }
}

/**
 * Deterministic block id sequence (c0001, c0002, ...): with it the catalog
 * doc's toJSON() is byte-stable across runs, which the JSON golden relies on.
 */
function deterministicIdGenerator(): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `c${String(next).padStart(4, "0")}`;
  };
}

/**
 * Build the v1 catalog document: every v1 block type and every v1 mark in a
 * fixed order, via public core commands only. The whole build is one
 * transaction: one wire update and one undo step. The trailing paragraph is
 * the last paragraph in reading order, so the pane's current-block label
 * lands on it.
 */
function buildCatalogDoc(doc: Doc): void {
  doc.transact(() => {
    doc.setTitle("Catalog");

    const intro = doc.insertBlock("paragraph");
    doc.insertText(intro, 0, "Catalog: all v1 blocks and marks");

    for (const level of HEADING_LEVELS) {
      const heading = doc.insertBlock("heading", { level });
      doc.insertText(heading, 0, `Heading ${level}`);
    }

    // Lists: all three variants and a nested level under the second bullet.
    const bulletOne = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(bulletOne, 0, "bullet one");
    const bulletTwo = doc.insertBlock("list-item", { list: "bullet" });
    doc.insertText(bulletTwo, 0, "bullet two");
    const nested = doc.insertBlock("list-item", { list: "bullet" }, { parent: bulletTwo });
    doc.insertText(nested, 0, "nested bullet");
    const numberOne = doc.insertBlock("list-item", { list: "number" });
    doc.insertText(numberOne, 0, "number one");
    const numberTwo = doc.insertBlock("list-item", { list: "number" });
    doc.insertText(numberTwo, 0, "number two");
    const taskOpen = doc.insertBlock("list-item", { list: "task" });
    doc.insertText(taskOpen, 0, "task open");
    const taskDone = doc.insertBlock("list-item", { list: "task", checked: true });
    doc.insertText(taskDone, 0, "task done");

    // Callouts: the default (info) plus every registry variant.
    const calloutDefault = doc.insertBlock("callout");
    doc.insertText(calloutDefault, 0, "callout (default)");
    const calloutInfo = doc.insertBlock("callout", { variant: "info" });
    doc.insertText(calloutInfo, 0, "callout info");
    const calloutWarning = doc.insertBlock("callout", { variant: "warning" });
    doc.insertText(calloutWarning, 0, "callout warning");
    const calloutDanger = doc.insertBlock("callout", { variant: "danger" });
    doc.insertText(calloutDanger, 0, "callout danger");

    const code = doc.insertBlock("code", { language: "ts" });
    doc.insertText(code, 0, "const catalog: number = 1;");
    // Mermaid: a small 2-node graph (the harness renders it as a diagram
    // via the ./mermaid subpath — the renderer is registered on every pane).
    const mermaidCode = doc.insertBlock("code", { language: "mermaid" });
    doc.insertText(mermaidCode, 0, "graph TD\n A --> B");
    const latex = doc.insertBlock("latex", { display: true });
    doc.insertText(latex, 0, "E = mc^2");

    // Table 2x2 with a paragraph in every cell.
    const table = doc.insertBlock("table", { cols: 2 });
    for (let row = 1; row <= 2; row++) {
      const rowId = doc.insertBlock("table-row", undefined, { parent: table });
      for (let col = 1; col <= 2; col++) {
        const cellId = doc.insertBlock("table-cell", undefined, { parent: rowId });
        const cellText = doc.insertBlock("paragraph", undefined, { parent: cellId });
        doc.insertText(cellText, 0, `cell ${row}-${col}`);
      }
    }

    doc.insertBlock("image", { src: CATALOG_IMAGE_KEY });
    doc.insertBlock("divider");

    // Embed: the fixed harness src (the data: URL renders a tiny inline page).
    doc.insertBlock("embed", { kind: "iframe", src: EMBED_SRC });

    // Sync-embed: the catalog's master (seeded deterministically, fixed id)
    // renders its content inside; the outer JSON carries the ref only.
    doc.insertBlock("sync-embed", { ref: { docId: CATALOG_MASTER_ID } });

    // Database: the harness seed (the placeholder card in the goldens; the
    // table UI is the consumer's level).
    seedDatabase(doc);

    // The marks paragraph: the fixed run layout, one run at a time.
    const marks = doc.insertBlock("paragraph");
    let offset = 0;
    for (const entry of MARKS_LAYOUT) {
      doc.insertText(marks, offset, entry.text, entry.marks);
      offset += entry.text.length;
    }

    const trailing = doc.insertBlock("paragraph");
    doc.insertText(trailing, 0, "Trailing paragraph");
  });
}

/**
 * The pane's doc: the catalog (deterministic ids) or the empty seed with the
 * pane's first paragraph.
 */
function seedPaneDoc(catalog: boolean): Doc {
  const doc = catalog
    ? createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT, generateId: deterministicIdGenerator() })
    : createDoc({ id: DOC_ID, createdAt: DOC_CREATED_AT });
  if (catalog) {
    buildCatalogDoc(doc);
  } else {
    doc.insertBlock("paragraph");
  }
  return doc;
}

export { buildCatalogDoc, deterministicIdGenerator, DOC_ID, seedPaneDoc };
