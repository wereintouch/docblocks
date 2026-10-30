/** The inline text types: the mark set + the mark names, the mention mark +
 *  its target kind, and the text run / block content. */

/** The mention mark's target kind. */
type MentionKind = "user" | "doc";

/** A mention: a weak ref to a consumer user / document + the display label
 *  snapshot (the name at insertion time — stable display; the consumer may
 *  render a "removed" state by id). Non-cascading (a removed target leaves the
 *  label standing). */
interface MentionMark {
  kind: MentionKind;
  id: string;
  label: string;
}

/** The set of marks applied to a run. */
interface MarkSet {
  bold?: true;
  italic?: true;
  strike?: true;
  underline?: true;
  /** Exclusive: never coexists with other marks on the same run. */
  code?: true;
  /** http/https URL or relative path. */
  link?: { href: string };
  /** A weak ref to a user / document + the display label snapshot. */
  mention?: MentionMark;
  /** Text color, hex `#RRGGBB` (alpha optional). */
  color?: { value: string };
  /** Text highlight, hex `#RRGGBB` (alpha optional). */
  highlight?: { value?: string };
  /**
   * The cross-minor opaque stand: an unknown mark name (a future minor's
   * data) is preserved as-is — the reader/renderer stand the text without
   * it, the data is not lost on save. The strict validator rejects it.
   */
  [name: string]: unknown;
}

/**
 * All known mark names (the MARK_REGISTRY keys; the MarkSet index signature
 * is the opaque stand for unknown names, not part of this union).
 */
type MarkName = "bold" | "italic" | "strike" | "underline" | "code" | "link" | "mention" | "color" | "highlight";

/** An inline text run: a span of text with the marks applied to it. */
interface TextRun {
  text: string;
  marks: MarkSet;
}

/** Inline text content of a block: an array of runs. */
type BlockContent = TextRun[];

export type { BlockContent, MarkName, MarkSet, MentionKind, MentionMark, TextRun };
