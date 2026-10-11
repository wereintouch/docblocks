/**
 * Flat text deltas: one contiguous replacement region — the model every
 * input event and every remote/undo text change reduces to.
 */

/** A single-region text replacement. */
type TextDelta = {
  /** Start of the replaced region in both the old and the new text. */
  from: number;
  /** How many old-text characters are replaced. */
  deleteLen: number;
  /** The replacement text ("" = pure delete). */
  inserted: string;
};

/**
 * Diff two texts as a single region: the longest common prefix and the
 * longest common suffix are kept, everything between is replaced.
 * Returns null when the texts are equal.
 */
function diffTexts(oldText: string, newText: string): TextDelta | null {
  if (oldText === newText) return null;
  const minLen = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < minLen && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  while (
    suffix < minLen - prefix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix++;
  }
  return {
    from: prefix,
    deleteLen: oldText.length - prefix - suffix,
    inserted: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Map a flat character offset across a single-region replacement, using
 * the same point rule as the core's selection rebase: an insertion
 * exactly at the offset does not move it; a deletion covering it keeps
 * it at the deletion start.
 */
function rebaseOffset(offset: number, delta: TextDelta): number {
  const removed = Math.min(Math.max(offset - delta.from, 0), delta.deleteLen);
  return offset - removed + (offset > delta.from ? delta.inserted.length : 0);
}

export { diffTexts, rebaseOffset };
export type { TextDelta };
