/** The provider's base props: the document and its collaboration stand,
 *  the block renderers, the blob / database bridges, the PDF preview, and
 *  the entry-list root. */
import type { ReactNode } from "react";

import type { BlockId, Doc, SyncProvider } from "docblocks-core";

import type { BlobStore } from "../../blob-store";
import type { BlockRendererMap } from "../../blocks";
import type { DatabaseBridge } from "../../database";
import type { PdfPreview } from "./pdf";

/** The blob loading policy: the viewport-gated lazy stand (the default) or
 *  the eager stand (every block resolves at mount). */
type BlobLoading = "eager" | "lazy";

interface EditorProviderBaseProps {
  /**
   * The headless document to render and edit; must not change after mount.
   * Required over the editor's stand. Over the `viewer`'s stand the doc IS
   * the published snapshot — the consumer passes only the stand the reader
   * may see (the live document never reaches the reader's browser); an
   * absent stand over the viewer renders the not-published placeholder.
   */
  doc?: Doc;
  /** Optional sync transport for presence (awareness); the doc's own changes are always tracked. */
  provider?: SyncProvider;
  /**
   * Optional per-instance block renderers: a consumer renderer for a type
   * replaces the built-in one (view-layer customization). Replacing a
   * text-editable type replaces the whole block view, including its
   * editing affordance; a renderer that needs editing drives the core
   * commands through the hooks. Pass a stable reference for the map
   * (module-level or memoized): it is read into the provider context per
   * render, so a fresh inline object would churn the context value and
   * re-render every context consumer.
   */
  blockRenderers?: BlockRendererMap;
  /**
   * Optional blob bridge: returns bytes + authoritative metadata by file id,
   * uploads and renames files, and notifies open views about store changes.
   * Without it the editor uses the shared default in-memory store, cleared on
   * page reload. Pass a stable reference; nested providers inherit it.
   */
  blobStore?: BlobStore;
  /**
   * The blob loading policy. "lazy" (the default) resolves a block's bytes
   * only when the block enters the viewport's preload band — the blocks
   * standing above the fold on mount and the cover resolve eagerly; "eager"
   * resolves every block at mount (the pre-lazy behavior). The metadata's
   * lookup (the store's `getMeta`) always runs at mount: it is the cheap
   * head stand the placeholder's aspect-ratio reservation reads.
   *
   * A nested provider that supplies none inherits the enclosing policy.
   */
  blobLoading?: BlobLoading;
  /**
   * The scroll container that scrolls the document, when the consumer
   * renders the editor inside its own `overflow` box instead of the page
   * scroll. The lazy blob resolution's preload band is measured against
   * this element (an element clipped by an inner scroller never intersects
   * a window-rooted observer, so the band would shrink to the visible
   * area); the first screen's eager stand is measured against its box too.
   *
   * `null` (the default) stands the window — the page scroll. The value is
   * read per render into the provider context: pass a stable reference. A
   * nested provider that passes nothing inherits the enclosing container;
   * an explicit `null` frames its own subtree on the window.
   */
  scrollContainer?: Element | null;
  /**
   * Optional database bridge: the consumer's implementation of the table
   * operations behind the external-form database blocks (the document
   * keeps only the `tableId` reference; the schema and the rows live in
   * the consumer's database). Without it the external-form blocks render
   * the disconnected placeholder (the inline form stands unchanged — its
   * data is the document's own).
   *
   * Like `blobStore`, the value is read per render into the provider
   * context: pass a stable reference. A nested provider that supplies
   * none inherits the enclosing bridge.
   */
  databaseBridge?: DatabaseBridge;
  /**
   * Optional PDF first-page preview renderer for file blocks and legacy PDF
   * image blocks. The component receives the library-owned object URL and the
   * store's authoritative metadata. Without it the native iframe stands.
   *
   * Like `blockRenderers`, the value is read per render into the provider
   * context: pass a stable reference (the component is module-level). A
   * nested provider that supplies none inherits the enclosing one.
   */
  pdfPreview?: PdfPreview;
  /**
   * Optional entry-list root: render the entry list of this block instead
   * of the document root (the subtree view — the block itself plus its own
   * subtree). Defaults to the document root: behavior unchanged.
   *
   * Like `doc`, the value must not change after mount.
   */
  rootBlockId?: BlockId;
  /**
   * The command palette placeholder override, shown while the caret sits in
   * an empty text block. The default comes from the editor locale. A nested
   * provider that supplies none inherits the enclosing override.
   */
  commandPalettePlaceholder?: string;
  children: ReactNode;
}

export type { BlobLoading, EditorProviderBaseProps };
