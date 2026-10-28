/**
 * The text storage model: a text block's content is a single `Y.Text` whose
 * per-character attributes are the marks. This is the CRDT-safe stand for the
 * former run array: formatting is a pure attribute operation (no text copy),
 * so concurrent formatting and deletion keep the text intact (character
 * identity is preserved). The JSON snapshot (`content: [{ text, marks }]`) is
 * derived from the delta and writes back into the single `Y.Text`.
 *
 * The attribute object and the `MarkSet` are isomorphic (mark name -> value:
 * `true` for toggles, an attribute object for `link`/`mention`/`color`/
 * `highlight`), so the conversions below are shallow copies.
 */
import * as Y from "yjs";

import { MARK_REGISTRY } from "@docblocks-core/schema";
import type { MarkName, MarkSet } from "@docblocks-core/schema";

/** All registered mark names. */
const MARK_NAMES = Object.keys(MARK_REGISTRY) as MarkName[];

/** The exclusive mark names (never coexist with other marks on a character). */
const EXCLUSIVE_MARK_NAMES = MARK_NAMES.filter((name) => MARK_REGISTRY[name].exclusive);

/** A Y.Text delta operation (insert / retain / delete with optional attributes). */
interface TextDeltaOp {
  insert?: string;
  retain?: number;
  delete?: number;
  attributes?: Record<string, unknown>;
}

/**
 * A `MarkSet` as a Y.Text attribute object (shallow copy, `undefined` dropped).
 * Empty when the mark set is empty (the caller then inserts without attributes).
 */
function markSetToAttrs(marks: MarkSet): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(marks)) {
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null) {
      const nested: Record<string, unknown> = {};
      for (const [key, attrValue] of Object.entries(value)) {
        if (attrValue !== undefined) nested[key] = attrValue;
      }
      attrs[name] = nested;
    } else {
      attrs[name] = value;
    }
  }
  return attrs;
}

/**
 * A Y.Text attribute object as a `MarkSet` (mirrors the snapshot reader:
 * `true` toggles kept, object values reduced to their string fields). The
 * cross-minor stand: an unknown mark name is preserved (its fields pass
 * through as-is, not only the string ones) — the data is not lost on save,
 * the reader/renderer stand the text without it, the strict validator
 * rejects it.
 */
function attrsToMarkSet(attributes?: Record<string, unknown> | null): MarkSet {
  const marks = {} as MarkSet;
  if (attributes === null || attributes === undefined) return marks;
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) {
      (marks as Record<string, unknown>)[name] = true;
    } else if (typeof value === "object" && value !== null) {
      const attrs: Record<string, unknown> = {};
      for (const [key, attrValue] of Object.entries(value)) {
        if (attrValue === undefined) continue;
        // Known marks are normalized to their string fields (the writer's
        // contract); an unknown mark passes its fields through as-is.
        if (name in MARK_REGISTRY && typeof attrValue !== "string") continue;
        attrs[key] = attrValue;
      }
      (marks as Record<string, unknown>)[name] = attrs;
    }
  }
  return marks;
}

/**
 * The maximal sub-spans of [from, to) that carry no exclusive mark. Formatting
 * a non-exclusive mark must skip characters that already hold an exclusive
 * mark (they stand untouched), so the caller formats exactly these spans.
 */
function exclusiveFreeSpans(content: Y.Text, from: number, to: number): Array<{ start: number; length: number }> {
  const spans: Array<{ start: number; length: number }> = [];
  let position = 0;
  for (const op of content.toDelta() as TextDeltaOp[]) {
    if (typeof op.insert === "string") {
      const length = op.insert.length;
      const carriesExclusive = EXCLUSIVE_MARK_NAMES.some((name) => name in (op.attributes ?? {}));
      const start = Math.max(position, from);
      const end = Math.min(position + length, to);
      if (start < end && !carriesExclusive) spans.push({ start, length: end - start });
      position += length;
    } else if (typeof op.retain === "number") {
      position += op.retain;
    }
  }
  return spans;
}

export { attrsToMarkSet, exclusiveFreeSpans, markSetToAttrs, MARK_NAMES as ALL_MARK_NAMES };
export type { TextDeltaOp };
