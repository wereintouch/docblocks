import type { BlockType } from "docblocks-core";

/** Placeholder for a block type without a dedicated renderer yet. */
function PlaceholderBlock({ type }: { type: BlockType }) {
  return <div data-block-type={type}>{type}</div>;
}

export { PlaceholderBlock };
