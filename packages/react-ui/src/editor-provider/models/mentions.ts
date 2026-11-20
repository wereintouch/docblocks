/** The mention customization: the `@` picker's catalog and the chip's
 *  interactions (the hover card, the click, the picker's empty state). */
import type { ReactNode } from "react";

import type { MentionKind, MentionMark } from "docblocks-core";

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
  /**
   * The chip's live label over the target's id (the synchronous read — the
   * consumer's cache over the catalog / the doc's meta). The chip's text
   * stands this label where it resolves (the rename's live stand), and the
   * insertion-time label (the run's text) otherwise; `null` / the absent
   * stand the insertion-time label (the removed's target's display is the
   * consumer's own fallback over this hook).
   */
  resolveLabel?(kind: MentionKind, id: string): string | null;
}

/**
 * The mention interactions: the consumer's hover card (the design + the
 * data — the package stands the position and the lifecycle only, over a
 * plain portaled host) and the chip's click (the consumer decides what
 * opens). The target stands the document's `mention` mark (the core's
 * `MentionMark`: the kind + the stable id) — the consumer resolves the
 * consumer resolves the current data over the id (the catalog, the URL).
 * Optional over the provider: without it the chip stands as before (no
 * card, the click is the browser's stand).
 */
interface MentionInteractions {
  /** The hover card's content (the consumer's design + data); `null`
   *  stands no card for this target (e.g. the removed's target stand). */
  renderCard: (mention: MentionMark) => ReactNode | null;
  /** The chip's click: the consumer decides what opens (the navigation,
   *  the modal). The native event — the consumer's `preventDefault()`
   *  keeps the caret in place (the atomic chip's default stand moves it).
   *  The package stands no default behavior and opens nothing. */
  onClick?: (mention: MentionMark, event: MouseEvent) => void;
  /**
   * The picker's empty state (the no-matches stand over the active query;
   *  the query is blank when only the `@` stands). The consumer's own
   *  content (the "start typing"'s phrase over the blank query — the
   *  package's i18n's stand is not overridable); `null` stands the built-in
   *  `common.noMatches` (the default).
   */
  renderEmptyState?: (query: string) => ReactNode | null;
}

export type { MentionEntry, MentionInteractions, MentionProvider };
