import type { MarkSet } from "docblocks-core";

/** The shared mark-set equality (the run merge): the same keys with the same values. */
function marksEqual(a: MarkSet, b: MarkSet): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return (keysA as (keyof MarkSet)[]).every((key) => key in b && JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export { marksEqual };
