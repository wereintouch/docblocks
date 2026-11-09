/** The editor provider's types: the sync-embed / embed-sandbox / pdf-preview
 *  / mention customization contracts, the per-instance selection ref, the
 *  context value, and the provider's props. */
import type { ComponentType, ReactNode } from "react";

import type { BlockId, Doc, SelectionView, SyncEmbedRef, SyncProvider } from "docblocks-core";

import type { BlobStore } from "../blob-store";
import type { BlockRendererMap } from "../blocks";
import type { DatabaseBridge } from "../database";
import type { EditorStore } from "../state";

/**
 * Resolves a sync-embed ref to the master doc the consumer holds; null when
 * the master is unknown to the consumer (the block renders its broken state).
 */
type SyncEmbedResolver = (ref: SyncEmbedRef) => Doc | null;

/** The embed sandbox policy: the iframe's `sandbox` value for a given embed
 *  src; `null` stands no sandbox (a fully trusted embed, the old behavior). */
type EmbedSandboxPolicy = (src: string) => string | null;

/** The props a PDF first-page preview renderer receives (the `pdfPreview` provider prop). */
interface PdfPreviewProps {
  /** The block's id — the renderer stamps it on its root, like the other block renderers. */
  id: BlockId;
  /** The resolved blob url (the store's resolve result). */
  url: string;
  /** The blob's display name (absent when the store has none). */
  name?: string;
}

/** A PDF first-page preview renderer: a component over a resolved `pdf` blob. */
type PdfPreview = ComponentType<PdfPreviewProps>;

/** A mention search result: the stable target id + the display label. */
interface MentionEntry {
  id: string;
  label: string;
}

/**
 * The consumer's mention search provider: the user / document catalog behind
 * the `@` mention trigger. The two sections are separate so the picker can
 * stand "People" and "Documents" groups; a `kind` is derived from the
 * section on the pick (`user` / `doc`).
 */
interface MentionProvider {
  /** The users matching the query (the `user` mention kind). */
  searchUsers(query: string): Promise<MentionEntry[]>;
  /** The documents matching the query (the `doc` mention kind). */
  searchDocs(query: string): Promise<MentionEntry[]>;
}

/** The per-instance selection view; null before the mount effect ran and after unmount. */
interface SelectionRef {
  view: SelectionView | null;
}

/** The consumer's user access level: the available document modes. "viewer" is locked to the published's view (the current state is never rendered); "editor" (the default) may edit and view. Session state — not document data, never on the wire. */
type AccessLevel = "viewer" | "editor";

/** The document's mode (consumer-controlled view state, like the page/canvas `view`): "edit" (the default) is the live document editable; "view" is the live document read-only (the current state, still syncing); "published" is the `publishedDoc`'s snapshot read-only (static). */
type EditorMode = "edit" | "view" | "published";

/** Per-instance editor context: the store, the doc, the selection handle, and the customization values. */
interface EditorContextValue {
  store: EditorStore;
  doc: Doc;
  selection: SelectionRef;
  /** Consumer renderers by block type; empty when none were supplied. */
  renderers: BlockRendererMap;
  /** The effective blob bridge (the consumer's store, the legacy resolver
   *  wrapped, or the shared default in-memory store) — always present. */
  blobStore: BlobStore;
  /** The effective database bridge (the consumer's implementation);
   *  undefined when none was supplied — the external-form database blocks
   *  render the disconnected placeholder. */
  databaseBridge: DatabaseBridge | undefined;
  /** The sync-embed master-doc resolver; null when none was supplied. */
  syncEmbedResolver: SyncEmbedResolver | null;
  /** The consumer's PDF first-page preview renderer; null when none was supplied (the native iframe stands). */
  pdfPreview: PdfPreview | null;
  /** The consumer's mention search provider; null when none was supplied (`@` stays plain text). */
  mentionProvider: MentionProvider | null;
  /** The effective embed sandbox policy (the consumer's, or the safe default) — always present. */
  embedSandbox: EmbedSandboxPolicy;
  /** The entry-list root: the document root by default, a subtree block otherwise. */
  rootBlockId: BlockId;
  /** The enclosing providers' doc ids, outermost first (the sync-embed cycle visited-set). */
  ancestorDocIds: readonly string[];
  /** The number of enclosing editor renders (the sync-embed cycle depth bound). */
  embedDepth: number;
  /** The empty-block hint text (the default points at the slash command palette). */
  commandPalettePlaceholder: string;
  /** The consumer's access level (the effective stand: the own prop, else the enclosing one, else "editor"). */
  accessLevel: AccessLevel;
  /** The effective document mode (resolved: a viewer stands "published" over any stand; a nested provider without its own `mode` inherits the enclosing one). */
  mode: EditorMode;
  /** True over the non-edit modes ("view" / "published"): every editing surface gates off (the read-only stand). */
  viewMode: boolean;
}

interface EditorProviderProps {
  /**
   * The headless document to render and edit; must not change after mount.
   * Required over the editor's stand. Over the `viewer`'s stand the doc IS
   * the published snapshot — the consumer passes only the stand the reader
   * may see (the live document never reaches the reader's browser); an
   * absent stand over the viewer renders the not-published placeholder.
   */
  doc?: Doc;
  /**
   * Optional user access level: "viewer" locks the render to the
   * published's view (the `mode`'s stand is ignored — the current state is
   * never rendered for a reader); "editor" (the default) may edit and
   * view. Over the viewer's stand the `doc` is the published snapshot and
   * the `publishedDoc` prop is not consulted (the doc IS the snapshot).
   * Session state supplied by the consumer — never document data.
   */
  accessLevel?: AccessLevel;
  /**
   * Optional document mode (consumer-controlled, like the page/canvas
   * `view`): "edit" (the default) renders the live document editable,
   * "view" renders it read-only (the current state, the doc keeps
   * syncing), "published" renders the `publishedDoc`'s snapshot read-only.
   * A viewer stands "published" over every stand. A nested provider
   * without its own `mode` inherits the enclosing one.
   */
  mode?: EditorMode;
  /**
   * Optional published snapshot (a hydrated `Doc`, the consumer's
   * `loadDoc` / `fromJSON` over its own stored state): rendered
   * read-only over the "published" mode (a static stand — no sync
   * transport). Must not change after mount (like `doc`): a new
   * snapshot is a consumer remount over a `key` change.
   */
  publishedDoc?: Doc | null;
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
   * Optional resolver of an image's blob key to an img src; without it the
   * image renders a placeholder.
   *
   * Like `blockRenderers`, the value is read per render into the provider
   * context: pass a stable reference (module-level or memoized) so the
   * context does not churn on every provider render.
   */
  blobResolver?: (key: string) => string;
  /**
   * Optional blob bridge: resolves a blob key to its displayable url and
   * metadata, and uploads a file to a new key (the slash Image path and
   * the future attachment blocks write the key only after the upload
   * resolved). Without it — and without `blobResolver` — the editor uses
   * the shared default in-memory store (uploads stand data urls for the
   * JS session; a page reload clears them), so the upload path works
   * out of the box.
   *
   * Like `blobResolver`, the value is read per render into the provider
   * context: pass a stable reference. A nested provider that supplies
   * none inherits the enclosing store.
   */
  blobStore?: BlobStore;
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
   * Optional resolver of a sync-embed's ref to the master Doc (the consumer
   * holds the master in its own store); without it the built-in renderer
   * renders the broken state for every sync-embed.
   *
   * The value is read per render into the provider context (like
   * `blockRenderers`): pass a stable reference. A provider nested inside
   * another inherits the enclosing resolver when it supplies none (a
   * sync-embed inside a rendered master must resolve too).
   */
  syncEmbedResolver?: SyncEmbedResolver;
  /**
   * Optional PDF first-page preview renderer: a component that renders a
   * `pdf`-subtype image block's resolved blob as a client-side first-page
   * preview (the `./pdf` subpath provides one over pdfjs-dist, an optional
   * peer). Without it the block stands the native iframe viewer.
   *
   * Like `blockRenderers`, the value is read per render into the provider
   * context: pass a stable reference (the component is module-level). A
   * nested provider that supplies none inherits the enclosing one.
   */
  pdfPreview?: PdfPreview;
  /**
   * Optional mention search provider: the user / document catalog behind the
   * `@` mention trigger in page text blocks. Without it the `@` stays plain
   * text (no picker). Like `pdfPreview`, the value is read per render into
   * the provider context: pass a stable reference. A nested provider that
   * supplies none inherits the enclosing one.
   */
  mentionProvider?: MentionProvider;
  /**
   * Optional embed sandbox policy: the iframe's `sandbox` value for a given
   * embed src; `null` stands no sandbox (a fully trusted embed). Without it
   * the safe default applies (`DEFAULT_EMBED_SANDBOX` — interactive but no
   * `allow-same-origin`, so the embedded content cannot read the parent's DOM
   * / state). Grant `allow-same-origin` only for trusted origins.
   *
   * Like `pdfPreview`, the value is read per render into the provider
   * context: pass a stable reference. A nested provider that supplies none
   * inherits the enclosing policy.
   */
  embedSandbox?: EmbedSandboxPolicy;
  /**
   * Optional entry-list root: render the entry list of this block instead
   * of the document root (the subtree view — the block itself plus its own
   * subtree). Defaults to the document root: behavior unchanged.
   *
   * Like `doc`, the value must not change after mount.
   */
  rootBlockId?: BlockId;
  /**
   * The command palette placeholder hint text, shown while the caret sits
   * in a text block with no content; defaults to "Type '/' for commands"
   * (`COMMAND_PALETTE_PLACEHOLDER`). A nested provider that supplies none
   * inherits the enclosing value, like the resolvers.
   */
  commandPalettePlaceholder?: string;
  children: ReactNode;
}

export type {
  AccessLevel,
  EditorContextValue,
  EditorMode,
  EditorProviderProps,
  EmbedSandboxPolicy,
  MentionEntry,
  MentionProvider,
  PdfPreview,
  PdfPreviewProps,
  SelectionRef,
  SyncEmbedResolver,
};
