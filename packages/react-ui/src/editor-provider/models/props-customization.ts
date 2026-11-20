/** The provider's customization props: the consumer-owned renderers and
 *  contracts a nested provider inherits when it supplies none. */
import type { AttributeTypePicker, RenderAttribute } from "./attributes";
import type { MentionInteractions, MentionProvider } from "./mentions";
import type { CoverPresetSets, DocDescription, DocTags } from "./panels";
import type { EmbedSandboxPolicy, SyncEmbedResolver } from "./sync-embed";

interface EditorProviderCustomizationProps {
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
   * Optional mention search provider: the user / document catalog behind the
   * `@` mention trigger in page text blocks. Without it the `@` stays plain
   * text (no picker). Like `pdfPreview`, the value is read per render into
   * the provider context: pass a stable reference. A nested provider that
   * supplies none inherits the enclosing one.
   */
  mentionProvider?: MentionProvider;
  /**
   * Optional mention interactions: the hover card's content
   * (`renderCard`), the chip's click's delivery (`onClick`), and the
   * picker's empty state (`renderEmptyState` — the no-matches' content
   * over the active query). The package stands the card's position +
   * lifecycle only (the portaled host, the hover's delay/grace, the
   * Escape's close, the anchor's removal's close) — the design and the
   * data are the consumer's, the click's stand is the consumer's. Like
   * `mentionProvider`, the value is read per render into the provider
   * context: pass a stable reference. A nested provider that supplies
   * none inherits the enclosing one.
   */
  mentionInteractions?: MentionInteractions;
  /**
   * Optional attribute keys to hide from the document-attributes panel
   * (the page column's above-the-first-block stand): the preset keys
   * (`description` / `tags` / `createdBy` / `cover` / `status` /
   * `publishedAt`), the custom keys, and the system rows (`id` /
   * `createdAt` / `updatedAt`). Consumer session state — never document
   * data. Like the other customization values, pass a stable reference.
   */
  hiddenAttributes?: readonly string[];
  /**
   * Optional consumer-owned tags contract (the document-attributes panel's
   * `tags` row): the tags are never document data (the consumer's store is
   * the source — the document never stores or syncs them). The panel
   * displays the passed list and reports the user's tag actions: the add
   * affordance's click (`onTagAdd` — the consumer's own creation's UI: the
   * tag's picker over its catalog, the creation's flow), the chip's
   * removal (`onTagRemove`), and the chip's click (`onTagClick` — the
   * native event, the package opens nothing). Like the other
   * customization values, the value is read per render into the provider
   * context: pass a stable reference (a memoized object). A nested
   * provider that supplies none inherits the enclosing one.
   */
  docTags?: DocTags;
  /**
   * Optional consumer-owned description contract (the document-attributes
   * panel's `description` row): the description is never document data
   * (the consumer's store is the source — the document never stores or
   * syncs it). The panel displays the passed value and reports the user's
   * edit over the `onEdit` callback (the panel's inline editor's commit —
   * the entered string verbatim; the empty string stands the removal's
   * stand — the consumer clears its store over the callback; the row's
   * removal's affordance stands over the non-empty's value and commits the
   * empty string's stand; without it the row stands display-only, over the
   * edit mode too). Over the prop's
   * presence the row stands out of the `renderAttribute`'s reach (the
   * consumer's value is the source). Like the other customization values,
   * the value is read per render into the provider context: pass a stable
   * reference (a memoized object). A nested provider that supplies none
   * inherits the enclosing one.
   */
  docDescription?: DocDescription;
  /**
   * Optional cover preset gallery (the document-attributes panel's cover row,
   * the upload modal's stand): the consumer's ready-made cover's file ids
   * (the consumer's blob store's ids — the same ids the store's `get`
   * resolves) per placement mode: the `tile`'s set and the `center`'s set
   * (each optional — a mode without a set stands no grid over it). The
   * modal renders the current mode's set over the preset's grid (the
   * 4-column's scrollable's stand; the mode's switch stands the set's switch
   * over the same grid's stand), and a pick commits the id over the mode
   * without an upload (the consumer's catalog's curation's stand — the
   * upload's gate is never run over a preset). The thumbnails resolve over
   * the store's `get`. Without the prop the grid stands absent (the modal
   * keeps the enlarged's base's stand).
   *
   * Like the other customization values, the value is read per render into
   * the provider context: pass a stable reference (a memoized object). A
   * nested provider that supplies none inherits the enclosing one.
   */
  coverPresets?: CoverPresetSets;
  /**
   * Optional per-key replacement of the document-attributes panel's value
   * zone (a preset key — `description` / `createdBy` / `cover` /
   * `status` / `publishedAt` — or a custom key; the `tags` row is the
   * consumer-owned stand over the `docTags`'s prop and stands out of
   * this renderer's reach; the `description` row stands out of it over
   * the `docDescription`'s prop's presence — the consumer's value is the
   * source over the stand). The renderer receives the
   * key, the current value, the commit / removal entries, and the
   * read-only stand; `null` (or the absent stand) selects the built-in
   * editor for that key. The row's label (the key's display name) is the
   * panel's — the consumer renders the value only. Like the other
   * customization values, the value is read per render into the provider
   * context: pass a stable reference.
   */
  renderAttribute?: RenderAttribute;
  /**
   * Optional replacement of the custom-attribute add flow's type picker
   * (the document-attributes panel's "add attribute" stand). The component
   * receives the selected type and the pick's commit; the type's vocabulary
   * is the shared `ATTRIBUTE_TYPES` enum (the consumer's picker stands its
   * own design over it). Like the other customization values, the value is
   * read per render into the provider context: pass a stable reference (the
   * component is module-level).
   */
  attributeTypePicker?: AttributeTypePicker;
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
}

export type { EditorProviderCustomizationProps };
