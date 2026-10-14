import type { BlockId, EmbedBlock as EmbedBlockType } from "docblocks-core";

/**
 * An embed (v1): a plain iframe for every kind — the kind is a renderer
 * hint only (all kinds render as an iframe; per-kind card renderers come
 * later), so an unknown kind (newer data) still renders the same iframe.
 * `src` is a URL, not a blob key: the consumer's blob resolver does not
 * apply. No sandbox attribute in v1 (the standard embed iframe). The block
 * is not text-editable, so the wrapper carries no gutter handle.
 */
function EmbedBlock({ id, block }: { id: BlockId; block: EmbedBlockType }) {
  const { kind, src, title } = block.attrs;
  return (
    <div
      data-slot="docblocks/block"
      data-block-type="embed"
      data-block-id={id}
      data-kind={kind}
      className="relative my-(--docblocks-block-spacing) outline-none"
    >
      <iframe data-slot="docblocks/embed" src={src} title={title ?? kind} loading="lazy" />
    </div>
  );
}

export { EmbedBlock };
