import { memo } from "react";

import type { BlockId } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { useBlock } from "../hooks";
import { ImageBlock } from "./ImageBlock";
import { PlaceholderBlock } from "./PlaceholderBlock";
import { TableBlock } from "./TableBlock";
import { TextBlock } from "./TextBlock";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

/**
 * Renders one block by id. Memoized on the stable id: the block snapshot
 * is store-driven by reference, so a change to a sibling block never
 * re-renders this component. A block removed by a peer renders nothing.
 *
 * Renderer resolution (per instance): a consumer renderer for the type,
 * then the built-in renderer, then the placeholder (unknown and future
 * types keep working).
 */
const BlockView = memo(function BlockView({ id }: { id: BlockId }) {
  const { renderers } = useEditorContext();
  const block = useBlock(id);
  if (block === undefined) return null;

  const custom = renderers[block.type];
  if (custom !== undefined) return custom({ id, block });

  switch (block.type) {
    case "paragraph":
      return <TextBlock id={id} block={block} tag="p" />;
    case "heading":
      return <TextBlock id={id} block={block} tag={HEADING_TAGS[block.attrs.level]} />;
    case "callout":
      return <TextBlock id={id} block={block} tag="aside" />;
    case "list-item":
      return <TextBlock id={id} block={block} tag="li" />;
    case "code":
      return <TextBlock id={id} block={block} tag="pre" />;
    case "latex":
      return <TextBlock id={id} block={block} tag="code" />;
    case "divider":
      return <hr data-slot="docblocks/divider" data-block-type="divider" data-block-id={id} />;
    case "image":
      return <ImageBlock id={id} block={block} />;
    case "table":
      return <TableBlock id={id} block={block} />;
    default:
      // table-row / table-cell render inside TableBlock; unknown types
      // fall through to the placeholder.
      return <PlaceholderBlock type={block.type} />;
  }
});

export { BlockView };
