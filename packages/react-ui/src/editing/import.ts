/**
 * The headless whole-document import: the consumer fills a FRESH document
 * (the empty root) from a markdown or HTML payload. The content is written
 * before the sync attach (the pre-attach write — the initial layout stands
 * in the first full-state bootstrap the attach sends), so the first wire
 * sync persists the imported content. The parsed blocks materialize over
 * the paste parsers' shared insertion (`insertNative` — the same typed
 * block / table / runs writes the paste pipeline uses), in ONE `doc.transact`:
 * one undo step, one wire update. The indents stand the parser's absolute
 * nesting (there is no caret to re-base to — no seat logic), clamped by the
 * sequence's jump rule: the first block anchors at indent 0, the rest may
 * exceed the predecessor's indent by at most 1 — the parser that drops a
 * whitespace-only parent can emit a deeper gap, and the core rejects such
 * an insert (the whole import would roll back); the clamp keeps the
 * content, the nesting compressed. An empty (or whitespace-only) payload is
 * a no-op: nothing is written and no transaction runs (no wire update). A
 * non-fresh document (the root already has children) throws
 * `ImportDocumentError` — the import fills the root, it never appends.
 */
import type { BlockId, Doc, DocAttributeValue } from "docblocks-core";

import { htmlToBlocks, insertNative } from "./clipboard";
import type { MaterializedBlock } from "./clipboard";
import { mapFrontmatter, parseFrontmatter } from "./frontmatter";
import { mdToBlocks } from "./markdown";

/** The import payload kind (the parser dispatch). */
type ImportKind = "markdown" | "html";

/** The document is not fresh: the import requires the empty root. */
class ImportDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportDocumentError";
  }
}

/**
 * Import a markdown / HTML payload into a fresh document (the empty root):
 * the parsed blocks fill the root in one transaction (one undo step, one
 * wire update). An empty (or whitespace-only) payload is a no-op. Throws
 * `ImportDocumentError` when the root already has children.
 */
function importDocument(doc: Doc, source: string, kind: ImportKind): void {
  const rootId = doc.meta.id;
  const existing = doc.getChildren(rootId);
  if (existing.length > 0) {
    throw new ImportDocumentError(
      `importDocument: the document is not fresh (the root has ${existing.length} children) — the import requires the empty root.`
    );
  }
  // The markdown's frontmatter stand: the header (if any)
  // stands the document's meta (the title + the attributes) over the SAME
  // transaction as the body's blocks (one undo step, one wire update); the
  // header is stripped before the parse (a leading `---` would otherwise
  // stand the divider's / the setext's discriminator). A frontmatter
  // WITHOUT a body is a meta-only import — not a no-op.
  let meta: { title?: string; attributes: Record<string, DocAttributeValue> } | null = null;
  let payload = source;
  if (kind === "markdown") {
    const frontmatter = parseFrontmatter(source);
    if (frontmatter !== null) {
      meta = mapFrontmatter(frontmatter.entries);
      payload = frontmatter.body;
    }
  }
  const parsed: MaterializedBlock[] = kind === "markdown" ? mdToBlocks(payload) : htmlToBlocks(source);
  if (parsed.length === 0 && meta === null) return;
  doc.transact(() => {
    if (meta !== null) {
      if (meta.title !== undefined) doc.setTitle(meta.title);
      for (const [key, value] of Object.entries(meta.attributes)) {
        doc.setAttribute(key, value);
      }
    }
    if (parsed.length > 0) materializeImport(doc, parsed);
  });
}

/**
 * The materialization into the root: the blocks append in the parser's
 * order (each after the previous), the indents absolute (the jump-rule
 * clamp only — the insertion's `after` chain makes every landing a tail
 * append, so no block is displaced).
 */
function materializeImport(doc: Doc, parsed: MaterializedBlock[]): void {
  const rootId = doc.meta.id;
  let after: BlockId | undefined;
  let prevIndent = 0;
  for (const block of parsed) {
    // The jump-rule clamp (the no re-base): the first block anchors at 0,
    // the rest stand the parser's absolute indent over the +1 cap.
    const indent = after === undefined ? 0 : Math.min(block.indent, prevIndent + 1);
    after = insertNative(doc, block, rootId, after, indent);
    prevIndent = indent;
  }
}

export { ImportDocumentError, importDocument };
