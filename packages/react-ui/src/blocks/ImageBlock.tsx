import type { BlockId, ImageBlock as ImageBlockType } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import { Card, CardContent } from "../shared/ui/Card";
import { Image as ImageIcon } from "../shared/ui/icons";

/**
 * An image: the <img> src comes from the consumer's blob resolver (the
 * key is opaque; resolution is a consumer-side concern). Without a
 * resolver or without a resolved src the block renders a structural
 * placeholder card instead of a broken <img>. No resize/crop UI.
 */
function ImageBlock({ id, block }: { id: BlockId; block: ImageBlockType }) {
  const { blobResolver } = useEditorContext();
  const src = blobResolver !== null ? blobResolver(block.attrs.src) : null;
  if (src === null || src === "") {
    return (
      <Card
        data-slot="docblocks/image-placeholder"
        data-block-type="image"
        data-block-id={id}
        className="
          mx-0 my-(--docblocks-block-spacing) rounded-(--docblocks-radius)
          border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
          outline-none
        "
      >
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <ImageIcon className="size-6" />
          image
        </CardContent>
      </Card>
    );
  }
  return (
    <img
      data-slot="docblocks/image"
      data-block-type="image"
      data-block-id={id}
      src={src}
      alt=""
      className="block max-w-full rounded-(--docblocks-image-radius)"
    />
  );
}

export { ImageBlock };
