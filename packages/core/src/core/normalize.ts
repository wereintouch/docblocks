import type { MarkSet, TextRun } from "@docblocks-core/schema";

/**
 * Run normalization (lazy, at read/export time; never affects correctness).
 *
 * Rules: adjacent runs with deeply-equal marks merge into one run; runs with
 * empty text are dropped; a run with empty marks is a valid plain run.
 * Normalization never changes the flattened text, only run boundaries.
 */

/** A run mark value: the known mark shapes, or the opaque value of an unknown mark (the cross-minor stand). */
type MarkValue = unknown;

/** Deep equality for a single mark value (`true` or an attribute object). */
function markValueEqual(a: MarkValue, b: MarkValue): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  return aKeys.every((key) => aObj[key] === bObj[key]);
}

function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const aEntries = Object.entries(a);
  const bEntries = Object.entries(b);
  if (aEntries.length !== bEntries.length) return false;
  const bValues = new Map(bEntries);
  return aEntries.every(([name, value]) => markValueEqual(value, bValues.get(name)));
}

function cloneMarks(marks: MarkSet): MarkSet {
  const clone = {} as MarkSet;
  for (const [name, value] of Object.entries(marks)) {
    if (value === undefined) continue;
    (clone as Record<string, unknown>)[name] = typeof value === "object" ? { ...value } : value;
  }
  return clone;
}

/** Normalized copy: merged adjacent equal-mark runs, empty-text runs dropped. */
function normalizeRuns(runs: readonly TextRun[]): TextRun[] {
  const result: TextRun[] = [];
  for (const run of runs) {
    if (run.text === "") continue;
    const prev = result[result.length - 1];
    if (prev !== undefined && marksEqual(prev.marks, run.marks)) {
      prev.text += run.text;
    } else {
      result.push({ text: run.text, marks: cloneMarks(run.marks) });
    }
  }
  return result;
}

export { normalizeRuns };
