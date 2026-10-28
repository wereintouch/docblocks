import * as Y from "yjs";

import type { BlockId } from "@docblocks-core/schema";

import { getBlockMap } from "../commands/structure";

/**
 * Per-block flattened text deltas.
 *
 * A block's text lives in a single `Y.Text` (its marks are the character
 * attributes); the selection only cares about the flattened string. Every
 * change is therefore composed into the canonical minimal string edit between
 * the block's PREVIOUS flattened text and the current one: mark-only changes
 * (which leave the string unchanged) produce no delta at all, and the rebase
 * result is independent of how the marks happen to be structured.
 *
 * Deltas use old-string positions, sorted by `pos`, with a delete preceding
 * an insert at equal `pos` (the spec's convention). Cost is bounded: a
 * change region whose old × new character product exceeds the cap falls
 * back to a single delete + insert hunk instead of the LCS table.
 *
 * One deep observer on the registered blocks map (the same technique as the
 * events hub) delivers the changes; the tracker keeps the previous flattened
 * text as its only state.
 */

/** One text change at old position `pos`. */
interface TextDelta {
  /** Index into the previous flattened block text. */
  pos: number;
  inserted: number;
  deleted: number;
}

/** Per-transaction delta list for one block (old-text positions, sorted by pos). */
type BlockTextDelta = TextDelta[];

/** LCS table cells per change region before the single-hunk fallback stands in. */
const REGION_CELL_CAP = 1_000_000;

/** The block's content text; null when the block is missing, corrupt, or non-text. */
function getContent(ydoc: Y.Doc, blockId: BlockId): Y.Text | null {
  const block = getBlockMap(ydoc, blockId);
  if (block === null) return null;
  const content = block.get("content");
  return content instanceof Y.Text ? content : null;
}

/** The flattened string of a content text. */
function flatten(content: Y.Text): string {
  return content.toString();
}

/**
 * Track the flattened text of one block for the lifetime of the returned
 * unbind: every transaction that changes the block's string composes its
 * edit into one `fn` call with the delta list. Bind while the selection
 * references the block; unbind when it no longer does.
 */
function trackBlockText(ydoc: Y.Doc, blockId: BlockId, fn: (deltas: BlockTextDelta) => void): () => void {
  const blocks = ydoc.getMap("blocks");
  const initial = getContent(ydoc, blockId);
  let previous = initial === null ? "" : flatten(initial);

  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[]): void => {
    // Any event under the block except its string-inert fields (attrs,
    // children, type): a text change still changes the flattened string.
    // The string comparison below stays the gate. Paths are relative to the
    // blocks map: [blockId, field, ...].
    let relevant = false;
    for (const event of events) {
      const path = event.path;
      if (path[0] === blockId && path[1] !== "attrs" && path[1] !== "children" && path[1] !== "type") {
        relevant = true;
        break;
      }
    }
    if (!relevant) return;

    const content = getContent(ydoc, blockId);
    if (content === null) return;
    const current = flatten(content);
    if (current === previous) return;

    const entries = diffTexts(previous, current);
    previous = current;
    if (entries.length > 0) fn(entries);
  };

  blocks.observeDeep(handler);
  return () => {
    blocks.unobserveDeep(handler);
  };
}

/** The canonical minimal edit of `old` → `next`, as old-position entries. */
function diffTexts(old: string, next: string): TextDelta[] {
  const entries: TextDelta[] = [];
  let oi = 0;
  let ni = 0;
  while (oi < old.length || ni < next.length) {
    // Common prefix: unchanged, no delta.
    while (oi < old.length && ni < next.length && old.charCodeAt(oi) === next.charCodeAt(ni)) {
      oi++;
      ni++;
    }
    if (oi >= old.length && ni >= next.length) break;

    // The change region is delimited by the next change and the last one:
    // skip the common suffix of the remaining tails.
    let suffix = 0;
    while (
      suffix < old.length - oi &&
      suffix < next.length - ni &&
      old.charCodeAt(old.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
    ) {
      suffix++;
    }
    const regionOld = old.slice(oi, old.length - suffix);
    const regionNew = next.slice(ni, next.length - suffix);

    if (regionOld.length * regionNew.length <= REGION_CELL_CAP) {
      entries.push(...lcsDiff(oi, regionOld, regionNew));
    } else {
      entries.push(...singleHunk(oi, regionOld, regionNew));
    }
    oi = old.length - suffix;
    ni = next.length - suffix;
  }
  // Canonical order: pos ascending, delete before insert at equal pos.
  entries.sort((a, b) => a.pos - b.pos || (a.deleted > 0 ? 0 : 1) - (b.deleted > 0 ? 0 : 1));
  return entries;
}

/** LCS table cell (0 past the filled area; indexing is `number | undefined` under noUncheckedIndexedAccess). */
function cell(dp: Uint32Array, index: number): number {
  return dp[index] ?? 0;
}

/**
 * Minimal edit of one change region (LCS): every character outside the
 * longest common subsequence is a delete (at its old index) or an insert
 * (at the old index of the following matched character).
 */
function lcsDiff(basePos: number, old: string, next: string): TextDelta[] {
  const n = old.length;
  const m = next.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return [{ pos: basePos, inserted: m, deleted: 0 }];
  if (m === 0) return [{ pos: basePos, inserted: 0, deleted: n }];

  const width = m + 1;
  const dp = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * width;
    const nextRow = (i + 1) * width;
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] =
        old.charCodeAt(i) === next.charCodeAt(j)
          ? cell(dp, nextRow + j + 1) + 1
          : Math.max(cell(dp, nextRow + j), cell(dp, row + j + 1));
    }
  }

  const entries: TextDelta[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && old.charCodeAt(i) === next.charCodeAt(j)) {
      i++;
      j++;
      continue;
    }
    const pos = i;
    const del = i < n && (j >= m || cell(dp, (i + 1) * width + j) >= cell(dp, i * width + j + 1));
    if (del) {
      let count = 0;
      while (
        i < n &&
        (j >= m ||
          (old.charCodeAt(i) !== next.charCodeAt(j) && cell(dp, (i + 1) * width + j) >= cell(dp, i * width + j + 1)))
      ) {
        i++;
        count++;
      }
      entries.push({ pos: basePos + pos, inserted: 0, deleted: count });
    } else {
      let count = 0;
      while (
        j < m &&
        (i >= n ||
          (old.charCodeAt(i) !== next.charCodeAt(j) && cell(dp, (i + 1) * width + j) < cell(dp, i * width + j + 1)))
      ) {
        j++;
        count++;
      }
      entries.push({ pos: basePos + pos, inserted: count, deleted: 0 });
    }
  }
  return entries;
}

/** Bounded fallback for oversized regions: one delete + one insert hunk. */
function singleHunk(basePos: number, old: string, next: string): TextDelta[] {
  const entries: TextDelta[] = [];
  const del = old.length;
  const ins = next.length;
  if (del > 0) entries.push({ pos: basePos, inserted: 0, deleted: del });
  if (ins > 0) entries.push({ pos: basePos, inserted: ins, deleted: 0 });
  return entries;
}

export { trackBlockText };
export type { BlockTextDelta, TextDelta };
