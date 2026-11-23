/** The flat page model's list markers: the nesting's cycle index and the
 *  `number` item's displayed label (decimal / lower-alpha / lower-roman). */

/**
 * The marker's cycle index (1|2|3) from the indent: the nesting depth is
 * unbounded and CSS cannot modulo it, so the renderer cycles it. The
 * marker style per cycle: disc / circle / square (bullet), decimal /
 * lower-alpha / lower-roman (number); the task list has no marker (the
 * checkbox stands in for it).
 */
function markerCycle(indent: number): number {
  return (indent % 3) + 1;
}

/** The displayed label of a `number` item's marker (the motion view renders it as text; the base view numbers the `ol` natively). */
function numberMarkerLabel(number: number, cycle: number): string {
  if (cycle === 2) return `${String.fromCharCode(96 + number)}.`; // lower-alpha
  if (cycle === 3) return `${toRoman(number)}.`; // lower-roman
  return `${number}.`; // decimal
}

/** 1 -> i, 2 -> ii, … (the lower-roman label). */
function toRoman(n: number): string {
  const TABLE: [number, string][] = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let rest = n;
  let out = "";
  for (const [value, glyph] of TABLE) {
    while (rest >= value) {
      out += glyph;
      rest -= value;
    }
  }
  return out;
}

export { markerCycle, numberMarkerLabel };
