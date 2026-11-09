import type { MarkSet, TextRun } from "docblocks-core";

/** The shared mark-set equality (the run merge): the same keys with the same values. */
function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return (keysA as (keyof MarkSet)[]).every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

/** Appends text to a run list, merging it into the tail run when the marks are equal (the mark set is copied — the caller's object stands untouched). */
function appendRun(runs: TextRun[], text: string, marks: MarkSet): void {
  if (text === "") return;
  const last = runs[runs.length - 1];
  if (last !== undefined && marksEqual(last.marks, marks)) {
    last.text += text;
    return;
  }
  runs.push({ text, marks: { ...marks } });
}

/**
 * The simple emphasis mark set a plain HTML tag carries (the b/strong →
 * bold, the i/em → italic, the u → underline, the s/strike/del → strike
 * mapping) — null when the tag maps to none. The tag's name stands
 * case-insensitive (the markdown pass's lowercase, the DOM pass's
 * uppercase). The richer mappings (the link's href, the style's color,
 * the mark's highlight) stay with the caller.
 */
function tagEmphasisMarks(tagName: string): MarkSet | null {
  switch (tagName.toLowerCase()) {
    case "b":
    case "strong":
      return { bold: true };
    case "i":
    case "em":
      return { italic: true };
    case "u":
      return { underline: true };
    case "s":
    case "strike":
    case "del":
      return { strike: true };
    default:
      return null;
  }
}

export { appendRun, marksEqual, tagEmphasisMarks };
