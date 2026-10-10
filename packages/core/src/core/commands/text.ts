/**
 * Text commands: insertText, deleteText — plus the run-level helpers shared
 * by the mark commands (raw runs, run creation, mark equality, run split).
 *
 * Offsets are in the flattened raw text (pre-normalization; normalization
 * never changes the text length). Runs are not merged on write; reads
 * normalize lazily.
 */
import * as Y from "yjs";

import { BLOCK_REGISTRY, validateMarkSet } from "@docblocks-core/schema";
import type { BlockType, MarkSet } from "@docblocks-core/schema";

import {
  InvalidMarkError,
  InvalidOperationError,
  InvalidRangeError,
  UnknownBlockError,
  formatValidationErrors,
} from "../errors";
import { localTransact } from "../layout";
import { blockTypeOf, getBlockMap } from "./blocks";

/** A run as stored in the layout, with its flattened offset. */
interface RawRun {
  entry: Y.Map<unknown>;
  text: Y.Text;
  marks: Y.Map<unknown>;
  /** Flattened offset of the run start (raw text). */
  start: number;
  /** Text length. */
  length: number;
  /** Index of the run in the content array. */
  index: number;
}

/** A text block ready for editing: its type and content (runs) array. */
interface TextContext {
  type: BlockType;
  content: Y.Array<Y.Map<unknown>>;
}

/** The target block must exist and carry text content; throws otherwise. */
function requireTextBlock(ydoc: Y.Doc, blockId: string): TextContext {
  const block = getBlockMap(ydoc, blockId);
  if (block === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);
  const type = blockTypeOf(ydoc, blockId);
  if (type === null) throw new UnknownBlockError(`Unknown block "${blockId}".`);
  const noText = new InvalidOperationError(`Block "${blockId}" (type "${type}") has no text content.`);
  if (!BLOCK_REGISTRY[type].content) throw noText;
  const content = block.get("content");
  if (!(content instanceof Y.Array)) throw noText;
  return { type, content: content as Y.Array<Y.Map<unknown>> };
}

/** Runs with flattened offsets, in stored order (raw, unnormalized). */
function rawRuns(content: Y.Array<Y.Map<unknown>>): RawRun[] {
  const runs: RawRun[] = [];
  let offset = 0;
  content.forEach((entry, index) => {
    if (!(entry instanceof Y.Map)) return;
    const text = entry.get("text");
    if (!(text instanceof Y.Text)) return;
    const marks = entry.get("marks");
    runs.push({
      entry,
      text,
      marks: marks instanceof Y.Map ? marks : new Y.Map<unknown>(),
      start: offset,
      length: text.length,
      index,
    });
    offset += text.length;
  });
  return runs;
}

/** Flattened raw text length — the offset boundary for text commands. */
function contentTextLength(content: Y.Array<Y.Map<unknown>>): number {
  let total = 0;
  content.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return;
    const text = entry.get("text");
    if (text instanceof Y.Text) total += text.length;
  });
  return total;
}

/** Stored marks Y.Map as a plain MarkSet (mirrors the snapshot reader). */
function readStoredMarks(marks: unknown): MarkSet {
  const result = {} as MarkSet;
  if (!(marks instanceof Y.Map)) return result;
  marks.forEach((value, name) => {
    if (value === true) {
      (result as Record<string, unknown>)[name] = true;
    } else if (value instanceof Y.Map) {
      const attrs: Record<string, string> = {};
      value.forEach((attrValue, attrKey) => {
        if (typeof attrValue === "string") attrs[attrKey] = attrValue;
      });
      (result as Record<string, unknown>)[name] = attrs;
    }
  });
  return result;
}

/** A new run Y.Map { text: Y.Text, marks } built from a plain run. */
function makeRun(text: string, marks: MarkSet): Y.Map<unknown> {
  const marksMap = new Y.Map<unknown>();
  for (const [name, value] of Object.entries(marks)) {
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null) {
      const nested = new Y.Map<unknown>();
      for (const [key, attrValue] of Object.entries(value)) {
        if (attrValue !== undefined) nested.set(key, attrValue);
      }
      marksMap.set(name, nested);
    } else {
      marksMap.set(name, value);
    }
  }
  const run = new Y.Map<unknown>();
  run.set("text", new Y.Text(text));
  run.set("marks", marksMap);
  return run;
}

/** Deep equality between a stored marks Y.Map and a plain MarkSet. */
function yMarksEqual(marks: Y.Map<unknown>, other: MarkSet): boolean {
  const otherEntries = Object.entries(other).filter(([, value]) => value !== undefined);
  if (marks.size !== otherEntries.length) return false;
  for (const [name, value] of otherEntries) {
    const stored = marks.get(name);
    if (stored === true) {
      if (value !== true) return false;
      continue;
    }
    if (!(stored instanceof Y.Map) || typeof value !== "object" || value === null) return false;
    const valueEntries = Object.entries(value).filter(([, attrValue]) => attrValue !== undefined);
    if (stored.size !== valueEntries.length) return false;
    for (const [key, attrValue] of valueEntries) {
      if (stored.get(key) !== attrValue) return false;
    }
  }
  return true;
}

/**
 * Splits the run that strictly contains `offset` into two: the head stays in
 * place, the tail becomes a new run right after it. Offsets on existing run
 * boundaries are a no-op.
 */
function splitRunAt(content: Y.Array<Y.Map<unknown>>, offset: number): void {
  for (const run of rawRuns(content)) {
    if (offset > run.start && offset < run.start + run.length) {
      const at = offset - run.start;
      const value = run.text.toString();
      run.text.delete(at, run.length - at);
      content.insert(run.index + 1, [makeRun(value.slice(at), readStoredMarks(run.marks))]);
      return;
    }
  }
}

/**
 * Inserts `text` at character offset `pos`, carrying `marks` (default:
 * none). Inside a run: a plain insert when the marks match, else a split.
 * On a boundary: extends the adjacent run with equal marks, else a new run.
 */
function insertText(ydoc: Y.Doc, blockId: string, pos: number, text: string, marks: MarkSet = {}): void {
  const { type, content } = requireTextBlock(ydoc, blockId);
  const total = contentTextLength(content);
  if (!Number.isInteger(pos) || pos < 0 || pos > total) {
    throw new InvalidRangeError(`pos must be an integer in [0, ${total}] (got ${pos}).`);
  }
  if (text === "") return; // no-op
  const markErrors = validateMarkSet(type, marks);
  if (markErrors.length > 0) {
    throw new InvalidMarkError(`Invalid marks for block "${blockId}": ${formatValidationErrors(markErrors)}`);
  }

  localTransact(ydoc, () => {
    const runs = rawRuns(content);
    let inside: RawRun | null = null;
    let next: RawRun | null = null;
    let prev: RawRun | null = null;
    for (const run of runs) {
      if (run.length === 0) continue;
      if (pos > run.start && pos < run.start + run.length) {
        inside = run;
      } else if (pos === run.start && next === null) {
        next = run;
      } else if (pos === run.start + run.length) {
        prev = run;
      }
    }

    if (inside !== null) {
      const at = pos - inside.start;
      if (yMarksEqual(inside.marks, marks)) {
        inside.text.insert(at, text);
        return;
      }
      const value = inside.text.toString();
      inside.text.delete(at, inside.length - at); // keep the head in the original run
      const pieces = [makeRun(text, marks)];
      const tail = value.slice(at);
      if (tail !== "") pieces.push(makeRun(tail, readStoredMarks(inside.marks)));
      content.insert(inside.index + 1, pieces);
      return;
    }

    // Boundary position: extend an adjacent run that carries the same marks.
    if (next !== null && yMarksEqual(next.marks, marks)) {
      next.text.insert(0, text);
      return;
    }
    if (prev !== null && yMarksEqual(prev.marks, marks)) {
      prev.text.insert(prev.length, text);
      return;
    }
    content.insert(next === null ? runs.length : next.index, [makeRun(text, marks)]);
  });
}

/**
 * Deletes the text range [from, to): trims the first and last touched runs,
 * drops fully covered runs. `from === to` is a no-op.
 */
function deleteText(ydoc: Y.Doc, blockId: string, from: number, to: number): void {
  const { content } = requireTextBlock(ydoc, blockId);
  const total = contentTextLength(content);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from > to || to > total) {
    throw new InvalidRangeError(`Range must satisfy 0 <= from <= to <= ${total} (got from=${from}, to=${to}).`);
  }
  if (from === to) return; // no-op

  localTransact(ydoc, () => {
    const runs = rawRuns(content);
    const dropped: number[] = [];
    for (const run of runs) {
      const end = run.start + run.length;
      if (end <= from || run.start >= to) continue; // untouched
      const fullyCovered = run.start >= from && end <= to;
      if (!fullyCovered) {
        const localFrom = Math.max(from - run.start, 0);
        const localTo = Math.min(to - run.start, run.length);
        run.text.delete(localFrom, localTo - localFrom);
      }
      if (fullyCovered) dropped.push(run.index);
    }
    // Delete in reverse so earlier indices stay valid.
    for (const index of dropped.reverse()) content.delete(index, 1);
  });
}

export { contentTextLength, deleteText, insertText, requireTextBlock, splitRunAt };
