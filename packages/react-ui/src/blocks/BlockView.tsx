import { type ReactNode, memo } from "react";

import type { BlockContent, BlockId } from "docblocks-core";

import { useBlock } from "../hooks";
import { renderRuns } from "../text/runs";
import { PlaceholderBlock } from "./PlaceholderBlock";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

function renderContent(content: BlockContent | undefined): ReactNode {
  return content === undefined ? null : renderRuns(content);
}

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
      return <p data-block-type="paragraph">{renderContent(block.content)}</p>;
    case "heading": {
      const Tag = HEADING_TAGS[block.attrs.level];
      return <Tag data-block-type="heading">{renderContent(block.content)}</Tag>;
    }
    case "callout":
      return (
        <aside data-block-type="callout" data-variant={block.attrs?.variant}>
          {renderContent(block.content)}
        </aside>
      );
    case "list-item":
      return (
        <li data-list={block.attrs.list} data-checked={block.attrs.checked}>
          {renderContent(block.content)}
        </li>
      );
    default:
      return <PlaceholderBlock type={block.type} />;
  }
});

export { BlockView };
