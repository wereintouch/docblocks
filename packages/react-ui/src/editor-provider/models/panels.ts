/** The document-attributes panel's consumer-owned contracts: the tags,
 *  the description, and the cover preset gallery. */
/**
 * A consumer-owned tag entry (the consumer's tag catalog): the stable id
 * (the removal / the event's identity) + the display label (the default
 * chip's text). The consumer's own type may extend it (the extra fields
 * stay opaque to the package).
 */
interface DocTag {
  id: string;
  label: string;
}

/**
 * The consumer-owned tags contract (the `docTags` provider prop): the tags
 * are NEVER document data — the consumer's store is the source (the
 * document never stores or syncs them), and the panel displays the passed
 * list and reports the user's tag actions over the callbacks (the full
 * event surface — over the consumer-owned data there are no document
 * events: no wire, no undo). The panel's add affordance hands the
 * creation's flow to the consumer (its own picker over the tag catalog,
 * the creation's flow — the package opens nothing). Without the prop the
 * row stands the `notSet`'s display-only stand (the legacy's stored
 * `attributes.tags` data stands inert — the consumer's migration's read
 * over `doc.meta.attributes`).
 */
interface DocTags {
  /** The document's tags (the consumer's store's read; `[]` = none). */
  tags: readonly DocTag[];
  /**
   * The add affordance's click (the panel's "+ tag"'s trigger): the
   * consumer opens its own creation's UI and updates the passed list over
   * its own state. Without it the add affordance stands absent.
   */
  onTagAdd?: () => void;
  /**
   * The chip's removal (the chip's `x`'s click): the consumer removes the
   * tag over its own store and passes the updated list back over `tags`.
   * Without it the chip stands without a removal affordance.
   */
  onTagRemove?: (tag: DocTag) => void;
  /**
   * The chip's click (the chip's body — the removal's `x` does not fire
   * this): the native `MouseEvent`; the package opens nothing and
   * preventDefaults nothing (the navigation's stand — the tag's page — is
   * the consumer's). Stands over the read-only modes too (the observing
   * gesture's parity).
   */
  onTagClick?: (tag: DocTag, event: MouseEvent) => void;
}

/**
 * The consumer-owned description contract (the `docDescription` provider
 * prop): the description is NEVER document data — the consumer's store is
 * the source (the document never stores or syncs it), and the panel's
 * `description` row displays the passed value and reports the user's edit
 * over `onEdit` (over the consumer-owned data there are no document events:
 * no wire, no undo). The inline editor's commit passes the entered string
 * verbatim — the empty string stands the removal's stand (the consumer
 * clears its store over the callback). Without the prop the row keeps the
 * built-in stand (the value over the doc's `attributes.description`
 * record); the legacy's stored `attributes.description` data stands inert
 * over the prop's presence (the consumer's migration's read over
 * `doc.meta.attributes`).
 */
interface DocDescription {
  /** The document's description (the consumer's store's read; `null` = none). */
  value: string | null;
  /**
   * The edit's commit (the panel's inline editor's Enter / blur — the
   * entered string verbatim; the empty string stands the removal's stand):
   * the consumer persists the value over its own store and passes the
   * updated stand back over `value`. Without it the row stands
   * display-only (the edit's and the removal's affordances stand absent,
   * over the edit mode too).
   */
  onEdit?: (value: string) => void;
}

/**
 * The consumer's cover preset gallery (the `coverPresets` provider prop):
 * the ready-made cover's file ids (the consumer's own blob store's ids) per
 * placement mode. The upload modal renders the current mode's ids over
 * the preset's grid (the 4-column's scrollable's stand); a pick commits
 * the id over the mode WITHOUT an upload (the consumer's catalog's curation's
 * stand — the upload's gate is never run over a preset), and the thumbnails
 * resolve over the store's `get` (the bytes' transfer's stand). Without the
 * prop (or over an absent / empty set) the grid stands absent.
 */
interface CoverPresetSets {
  /** The tile mode's preset's file ids; `[]` / the absent stands no grid over the tile's stand. */
  tile?: readonly string[];
  /** The centering mode's preset's file ids; `[]` / the absent stands no grid over the centering's stand. */
  center?: readonly string[];
}

export type { CoverPresetSets, DocDescription, DocTag, DocTags };
