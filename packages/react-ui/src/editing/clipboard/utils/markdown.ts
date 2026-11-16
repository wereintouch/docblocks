/**
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the parsed blocks (the `../../markdown` parser) are materialized into
 * the document by the shared multi-block pipeline (`./materialize`) — one
 * transaction, one undo step, one wire update. The code target takes the
 * raw text — no parsing, no marks (the fence syntax is its data).
 */
import type { BlockId, Doc } from "docblocks-core";

import { isFreshForMeta, mapFrontmatter, parseFrontmatter } from "../../frontmatter";
import { mdToBlocks } from "../../markdown";
import { materializePaste } from "./materialize";

function applyMdPaste(
  doc: Doc,
  seatId: BlockId,
  from: number,
  to: number,
  markdown: string,
  opts?: { keepSeat?: boolean }
): { blockId: BlockId; offset: number } | null {
  // The code target: the raw text, no parsing (the fence syntax is its
  // data). The clipboard's line endings are the platform's; the doc model
  // is the LF.
  if (doc.getBlock(seatId)?.type === "code") {
    const raw = markdown.replace(/\r\n?/g, "\n");
    doc.transact(() => {
      if (to > from) doc.deleteText(seatId, from, to);
      doc.insertText(seatId, from, raw);
    });
    return { blockId: seatId, offset: from + raw.length };
  }

  // The empty-document's frontmatter stand: over the fresh
  // room (the empty root / the single empty starter paragraph's seat) the
  // pasted header stands the document's meta (the title + the attributes)
  // over the SAME transaction as the body's paste (one undo step, one
  // wire update); the header is stripped before the parse (a leading
  // `---` would otherwise stand the divider's / the setext's stand). Over
  // a non-fresh document the header stands the plain markdown (the
  // divider / the setext's discriminator — the unchanged stand).
  const frontmatter = parseFrontmatter(markdown);
  if (frontmatter !== null && isFreshForMeta(doc, seatId)) {
    const meta = mapFrontmatter(frontmatter.entries);
    let landing: { blockId: BlockId; offset: number } | null = null;
    doc.transact(() => {
      if (meta.title !== undefined) doc.setTitle(meta.title);
      for (const [key, value] of Object.entries(meta.attributes)) {
        doc.setAttribute(key, value);
      }
      landing = materializePaste(doc, seatId, from, to, mdToBlocks(frontmatter.body), opts);
    });
    return landing;
  }

  return materializePaste(doc, seatId, from, to, mdToBlocks(markdown), opts);
}

export { applyMdPaste };
