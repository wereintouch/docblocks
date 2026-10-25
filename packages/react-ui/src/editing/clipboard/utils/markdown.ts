/**
 * The multi-block markdown paste (the `text/plain` branch, always-parsed):
 * the parsed blocks (the `../../markdown` parser) are materialized into
 * the document by the shared multi-block pipeline (`./materialize`) — one
 * transaction, one undo step, one wire update. The code target takes the
 * raw text — no parsing, no marks (the fence syntax is its data).
 */
import type { BlockId, Doc } from "docblocks-core";

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

  return materializePaste(doc, seatId, from, to, mdToBlocks(markdown), opts);
}

export { applyMdPaste };
