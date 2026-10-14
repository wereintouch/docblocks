import type { BlockId, Doc, SyncEmbedBlock as SyncEmbedBlockType } from "docblocks-core";

import { Editor } from "../Editor";
import { EditorProvider, useEditorContext } from "../EditorProvider";
import { cn } from "../shared/ui/cn";

/**
 * The sync-embed render depth bound (spec: the cycle guards are a
 * visited-set plus a max depth). The visited-set (the ancestor doc chain)
 * catches a doc that embeds itself one level down — the nested provider's
 * chain carries the doc's own id; the depth bound is the second line of
 * defense for long non-cyclic chains: an embed rendered deeper than this
 * shows the cycle placeholder.
 */
const MAX_EMBED_DEPTH = 8;

type SyncEmbedState = "resolved" | "broken" | "cycle";

/**
 * The resolved sync-embed: the master doc rendered through a fresh nested
 * provider (its own store, selection, undo — the master's edits are the
 * master's edits) with the entry list scoped to the ref's block subtree
 * when one is given. The nested provider inherits the enclosing renderers
 * and resolvers through the context (a sync-embed inside the master must
 * resolve too). The key remounts the provider when the ref changes (the
 * provider's doc must not change after mount); the consumer must keep the
 * Doc instance for one docId stable across the embed's lifetime.
 */
function SyncEmbedContent({ master, blockId }: { master: Doc; blockId?: BlockId }) {
  return (
    <div data-slot="docblocks/sync-embed-body" className="max-h-(--docblocks-sync-embed-max-height) overflow-y-auto">
      <EditorProvider doc={master} rootBlockId={blockId}>
        <Editor />
      </EditorProvider>
    </div>
  );
}

/** The broken and cycle placeholders (no cascade: the block stays in its own doc). */
function SyncEmbedPlaceholder({ state }: { state: Exclude<SyncEmbedState, "resolved"> }) {
  return (
    <div
      data-slot="docblocks/sync-embed-placeholder"
      data-state={state}
      className={cn(
        `
          border-(length:--docblocks-table-border-width) border-dashed border-(--docblocks-table-border-color)
          p-(--docblocks-code-padding) text-center
        `,
        state === "broken" && "text-(--docblocks-callout-border-color-danger)"
      )}
    >
      {state === "broken"
        ? "The master document for this synced block is unavailable."
        : "Circular synced block reference."}
    </div>
  );
}

/**
 * A sync-embed (v1.1): a live view of another document (the master),
 * optionally narrowed to a block subtree. The master is resolved by the
 * consumer's `syncEmbedResolver`; a write inside the embed is a command to
 * the master doc (the nested provider), never to this one. Not
 * text-editable: the wrapper carries no gutter handle. States (the
 * wrapper's `data-state`): `resolved` (the master renders), `broken` (the
 * master is unknown to the consumer or the ref's blockId is stale),
 * `cycle` (the ref re-enters the ancestor doc chain or the render depth
 * exceeds the bound).
 */
function SyncEmbedBlock({ id, block }: { id: BlockId; block: SyncEmbedBlockType }) {
  const { syncEmbedResolver, ancestorDocIds, embedDepth } = useEditorContext();
  const ref = block.attrs.ref;

  const cyclic = ancestorDocIds.includes(ref.docId) || embedDepth > MAX_EMBED_DEPTH;
  const master = cyclic ? null : (syncEmbedResolver?.(ref) ?? null);
  const stale = master !== null && ref.blockId !== undefined && master.getBlock(ref.blockId) === null;
  const state: SyncEmbedState = cyclic ? "cycle" : master === null || stale ? "broken" : "resolved";

  return (
    <div
      data-slot="docblocks/block"
      data-block-type="sync-embed"
      data-block-id={id}
      data-state={state}
      data-doc-id={ref.docId}
      className="
        relative my-(--docblocks-block-spacing) rounded-(--docblocks-radius)
        border-(length:--docblocks-table-border-width) border-(--docblocks-table-border-color) outline-none
      "
    >
      {state === "resolved" && master !== null && (
        <SyncEmbedContent key={`${ref.docId}:${ref.blockId ?? ""}`} master={master} blockId={ref.blockId} />
      )}
      {state === "broken" && <SyncEmbedPlaceholder state="broken" />}
      {state === "cycle" && <SyncEmbedPlaceholder state="cycle" />}
    </div>
  );
}

export { MAX_EMBED_DEPTH, SyncEmbedBlock };
