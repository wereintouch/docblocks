import type { Doc } from "docblocks-core";

/** A rendered block: id, type, and flattened text. */
interface PaneBlock {
  id: string;
  type: string;
  text: string;
}

/** The non-root blocks in reading order, as a plain snapshot. */
function readBlocks(doc: Doc): PaneBlock[] {
  const json = doc.toJSON();
  const root = json.blocks[json.id];
  const ids = root !== undefined && root.type === "root" ? root.children : [];
  return ids.map((id) => {
    const block = json.blocks[id];
    return { id, type: block === undefined ? "missing" : block.type, text: doc.getText(id) };
  });
}

/** The pane's current block: the last paragraph in reading order. */
function currentBlockOf(blocks: PaneBlock[]): string | null {
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i]!;
    if (block.type === "paragraph") return block.id;
  }
  return null;
}

export { currentBlockOf, readBlocks };
export type { PaneBlock };
