/** The built-in dispatch of one block (no consumer renderer): the text
 * types take the derived nested content through the wrapper (a list item
 * nests its sublist inside itself, the rest in its nested slot) — the
 * sequence views only; a flat (motion) row renders the block alone, its
 * derived nesting standing as the sequence's own rows; the non-text types
 * render standalone (their derived content stands after the block,
 * threaded by the sequence layer). */
import type { ReactNode } from "react";

import type { Block, BlockId } from "docblocks-core";

import { CodeHeader } from "./CodeHeader";
import { DatabaseBlock } from "./DatabaseBlock";
import { EmbedBlock } from "./EmbedBlock";
import { FrameBlock } from "./FrameBlock";
import { ImageBlock } from "./ImageBlock";
import { PlaceholderBlock } from "./PlaceholderBlock";
import { SurfaceBlock } from "./SurfaceBlock";
import { SyncEmbedBlock } from "./SyncEmbedBlock";
import { TextBlock } from "./TextBlock";
import { TableBlock } from "./table";

const HEADING_TAGS = { 1: "h1", 2: "h2", 3: "h3", 4: "h4", 5: "h5", 6: "h6" } as const;

function dispatchBuiltIn(
  id: BlockId,
  block: Block,
  nested: ReactNode,
  collapsible: boolean,
  flat: boolean,
  number: number | undefined
): ReactNode {
  switch (block.type) {
    case "paragraph":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="div"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "quote":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="div"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "heading":
      return (
        <TextBlock
          id={id}
          block={block}
          tag={HEADING_TAGS[block.attrs.level]}
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "callout":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="aside"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "list-item":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="li"
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "code":
      return (
        <TextBlock
          id={id}
          block={block}
          tag="pre"
          header={<CodeHeader id={id} block={block} />}
          nested={nested}
          collapsible={collapsible}
          flat={flat}
          number={number}
        />
      );
    case "divider":
      return (
        <hr
          data-slot="docblocks/divider"
          data-block-type="divider"
          data-block-id={id}
          className="
            m-(--docblocks-divider-margin) border-0 border-t-(length:--docblocks-divider-border-width)
            border-t-(--docblocks-divider-border-color)
          "
        />
      );
    case "image":
      return <ImageBlock id={id} block={block} />;
    case "database":
      return <DatabaseBlock id={id} block={block} />;
    case "embed":
      return <EmbedBlock id={id} block={block} />;
    case "sync-embed":
      return <SyncEmbedBlock id={id} block={block} />;
    case "table":
      return <TableBlock id={id} block={block} />;
    case "surface":
      return <SurfaceBlock id={id} block={block} />;
    case "frame":
      // The frame renders through FrameBlock in every context: inside a
      // surface (the box + the nested provider) and as a provider entry
      // root (its own nested provider renders the content). A stray one
      // at the page root (lenient data) renders its content in place
      // (the container posture, like a stray table).
      return <FrameBlock id={id} />;
    case "shape":
    case "connector":
    case "canvas-text":
      // The canvas element types render ONLY inside a surface (the
      // CanvasItem dispatch). A stray one at the page root (lenient data
      // — the registry forbids it) falls to the placeholder (the
      // unknown-kind posture).
      return <PlaceholderBlock type={block.type} />;
    default:
      // table-row / table-cell render inside TableBlock; unknown types
      // fall through to the placeholder.
      return <PlaceholderBlock type={block.type} />;
  }
}

export { dispatchBuiltIn };
