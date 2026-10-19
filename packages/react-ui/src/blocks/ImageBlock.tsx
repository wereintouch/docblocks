import { useEffect, useState } from "react";

import type { BlockId, ImageBlock as ImageBlockType } from "docblocks-core";

import { useEditorContext } from "../EditorProvider";
import type { BlobRef } from "../blob-store";
import { Card, CardContent } from "../shared/ui/Card";
import { Image as ImageIcon } from "../shared/ui/icons";

/** The placeholder card's shared classes (the unknown-key and loading states). */
const PLACEHOLDER_CLASS = `
  mx-0 my-(--docblocks-block-spacing) rounded-(--docblocks-radius)
  border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
  outline-none
`;

/**
 * An image: the <img> src comes from the consumer's blob store (the key is
 * opaque; resolution is a consumer-side concern). The store's metadata
 * decides the rendering — the block never guesses: an image subtype
 * stands the <img>, a pdf an iframe viewer, a file the download card.
 * While the key is unknown (or the resolve is in flight) the block renders
 * a structural placeholder card instead of a broken <img>. No resize/crop UI.
 */
function ImageBlock({ id, block }: { id: BlockId; block: ImageBlockType }) {
  const { blobStore } = useEditorContext();
  const src = block.attrs.src;
  const [ref, setRef] = useState<BlobRef | null>(null);

  // The async resolve (store-driven): a stale result never lands — the
  // effect re-runs on the src or store change and drops the pending one.
  useEffect(() => {
    let alive = true;
    setRef(null);
    blobStore
      .resolve(src)
      .then((resolved) => {
        if (alive) setRef(resolved);
      })
      .catch(() => {
        if (alive) setRef(null);
      });
    return () => {
      alive = false;
    };
  }, [blobStore, src]);

  if (ref === null) {
    return (
      <Card
        data-slot="docblocks/image-placeholder"
        data-block-type="image"
        data-block-id={id}
        className={PLACEHOLDER_CLASS}
      >
        <CardContent className="flex flex-col items-center gap-2 text-center">
          <ImageIcon className="size-6" />
          image
        </CardContent>
      </Card>
    );
  }

  const { url, meta } = ref;
  if (meta.subtype === "pdf") {
    return (
      <iframe
        data-slot="docblocks/image-pdf"
        data-block-type="image"
        data-block-id={id}
        data-subtype="pdf"
        src={url}
        title={meta.name ?? "document"}
        className="
          my-(--docblocks-block-spacing) block aspect-video w-full rounded-(--docblocks-image-radius)
          border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
        "
      />
    );
  }
  if (meta.subtype === "file") {
    return (
      <Card
        data-slot="docblocks/image-file"
        data-block-type="image"
        data-block-id={id}
        data-subtype="file"
        className={PLACEHOLDER_CLASS}
      >
        <CardContent className="flex items-center justify-center gap-2">
          <ImageIcon className="size-4 shrink-0" />
          <a href={url} download={meta.name ?? src} className="max-w-60 truncate text-sm underline underline-offset-2">
            {meta.name ?? src}
          </a>
        </CardContent>
      </Card>
    );
  }
  return (
    <img
      data-slot="docblocks/image"
      data-block-type="image"
      data-block-id={id}
      data-subtype="image"
      src={url}
      alt=""
      className="block max-w-full rounded-(--docblocks-image-radius)"
    />
  );
}

export { ImageBlock };
