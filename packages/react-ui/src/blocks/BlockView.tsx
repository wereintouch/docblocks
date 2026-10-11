import { memo } from "react";

import type { BlockId } from "docblocks-core";

import { useBlock } from "../hooks";
import { PlaceholderBlock } from "./PlaceholderBlock";
import { TextBlock } from "./TextBlock";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

/**
 * Renders one block by id. Memoized on the stable id: the block snapshot
 * is store-driven by reference, so a change to a sibling block never
 * re-renders this component. A block removed by a peer renders nothing.
 */
const BlockView = memo(function BlockView({ id }: { id: BlockId }) {
  const block = useBlock(id);
  if (block === undefined) return null;

  switch (block.type) {
    case "paragraph":
      return <TextBlock id={id} block={block} tag="p" />;
    case "heading":
      return <TextBlock id={id} block={block} tag={HEADING_TAGS[block.attrs.level]} />;
    case "callout":
      return <TextBlock id={id} block={block} tag="aside" />;
    case "list-item":
      return <TextBlock id={id} block={block} tag="li" />;
    default:
      return <PlaceholderBlock type={block.type} />;
  }
});

export { BlockView };
